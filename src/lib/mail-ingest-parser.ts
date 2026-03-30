import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import * as XLSX from "xlsx";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { countryLabelFromRoute, inferRouteFromSubject } from "@/lib/carriers";
import { geminiModelName } from "@/lib/gemini-model";

/** Šalis pagal pakrovimo / krovinio vietą laiške ir prieduose — ne pagal siuntėjo paštą. */
function inferCountryFromBodyAndSubject(body: string, subject: string): string | null {
  const t = `${body}\n${subject}`.toLowerCase();
  if (
    /nyderland|nederland|netherlands|holland|zwijndrecht|merwedeweg|\bbolia\b|oranje transport|the netherlands/.test(
      t,
    )
  ) {
    return "Nyderlandai";
  }
  if (/italija|\bitaly\b|italia|furninova|saba italia|\bsrl\b.*ital|made in italy/.test(t)) {
    return "Italija";
  }
  if (/lenkija|\bpoland\b|polska|polski|warsaw|krakow/.test(t)) {
    return "Lenkija";
  }
  return null;
}

function fallbackCountryFromMailContent(
  body: string,
  subject: string,
  attachmentText?: string,
): string {
  const block = `${body}\n${attachmentText ?? ""}`;
  return (
    inferCountryFromBodyAndSubject(block, subject) ??
    countryLabelFromRoute(inferRouteFromSubject(subject)) ??
    "test"
  );
}

function fallbackManufacturerFromBody(body: string): string {
  const lines = body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const skip = /^(dear|hello|hi|sveiki|good|tema:|from:|nuo:|subject)/i;
  for (const line of lines.slice(0, 12)) {
    if (line.length >= 4 && line.length < 180 && !skip.test(line)) {
      return line.slice(0, 200);
    }
  }
  return "Nežinoma (patikrinkite laišką)";
}

export type GraphAttachment = {
  id: string;
  name?: string;
  contentType?: string;
  size?: number;
  contentBytes?: string;
};

export type ParsedOrderData = {
  manufacturer: string | null;
  country: string | null;
  pickupAddress: string | null;
  /** Užsakymo / paėmimo nuorodos iš gamintojo laiško ar priedų (ne vidinis TU#) */
  pickupReference: string | null;
  weightKg: number | null;
  volumeM3: number | null;
  cargoValue: number | null;
  shipperComment: string;
  parsedConfidence: number | null;
  reviewRequired: boolean;
  reviewNotes: string | null;
};

function decodeB64(b64: string): Buffer {
  return Buffer.from(b64, "base64");
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function parsePdf(buffer: Buffer): Promise<string> {
  try {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    const textResult = await parser.getText();
    await parser.destroy();
    return textResult.text?.trim() || "";
  } catch {
    return "";
  }
}

function parseExcel(buffer: Buffer): string {
  try {
    const wb = XLSX.read(buffer, { type: "buffer" });
    const chunks: string[] = [];
    for (const name of wb.SheetNames) {
      const ws = wb.Sheets[name];
      if (!ws) continue;
      const csv = XLSX.utils.sheet_to_csv(ws);
      if (csv.trim()) chunks.push(`# Sheet: ${name}\n${csv}`);
    }
    return chunks.join("\n\n");
  } catch {
    return "";
  }
}

async function parseDocx(buffer: Buffer): Promise<string> {
  try {
    const out = await mammoth.extractRawText({ buffer });
    return out.value?.trim() || "";
  } catch {
    return "";
  }
}

function ext(name?: string): string {
  if (!name) return "";
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(",", ".").replace(/[^\d.-]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function extractFurninovaHeaderReference(text: string): string | null {
  const m = text.match(/lista\s+zaladunkowa\s+nr\s*[:\-]?\s*([A-Z0-9\/\-_]+)/i);
  return m?.[1]?.trim() || null;
}

function preferFurninovaReference(
  manufacturer: string | null,
  subject: string,
  body: string,
  attachmentText: string,
  aiReference: string | null,
): string | null {
  const context = `${manufacturer ?? ""}\n${subject}\n${body}\n${attachmentText}`.toLowerCase();
  if (!context.includes("furninova")) {
    return aiReference;
  }
  const topRef =
    extractFurninovaHeaderReference(attachmentText) ??
    extractFurninovaHeaderReference(body);
  return topRef ?? aiReference;
}


export async function extractAttachmentTexts(attachments: GraphAttachment[]): Promise<string[]> {
  const chunks: string[] = [];
  for (const a of attachments) {
    const e = ext(a.name);
    if (!a.contentBytes) continue;
    const buffer = decodeB64(a.contentBytes);
    let parsed = "";
    if (e === "pdf") parsed = await parsePdf(buffer);
    else if (e === "xlsx" || e === "xls" || e === "csv") parsed = parseExcel(buffer);
    else if (e === "docx") parsed = await parseDocx(buffer);
    if (parsed.trim()) {
      chunks.push(`## Priedas: ${a.name ?? "failas"}\n${parsed.slice(0, 30000)}`);
    }
  }
  return chunks;
}

export async function parseOrderFromMailSources(input: {
  fromName: string;
  fromAddress: string;
  subject: string;
  bodyText: string;
  attachmentTexts: string[];
}): Promise<ParsedOrderData> {
  const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  const body = input.bodyText.trim();
  const att = input.attachmentTexts.join("\n\n");

  if (!key) {
    return {
      manufacturer: fallbackManufacturerFromBody(body),
      country: fallbackCountryFromMailContent(body, input.subject, att),
      pickupAddress: body.split(/\r?\n/).find((l) => l.trim()) ?? "Adresas laiške",
      pickupReference: null,
      weightKg: null,
      volumeM3: null,
      cargoValue: null,
      shipperComment: [`Tema: ${input.subject}`, `Nuo: ${input.fromAddress}`, "---", body]
        .join("\n")
        .slice(0, 50000),
      parsedConfidence: null,
      reviewRequired: true,
      reviewNotes:
        "Nėra GOOGLE_GENERATIVE_AI_API_KEY — šalis / gamintojas iš teksto (laiškas + priedai), ne iš siuntėjo.",
    };
  }

  const genAI = new GoogleGenerativeAI(key);
  const model = genAI.getGenerativeModel({
    model: geminiModelName(),
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
    },
  });

  const prompt = `Tu esi logistikos duomenų analizės asistentas. Duomenis imi iš laiško teksto ir priedų — ne iš siuntėjo el. pašto ar vardo.
Grąžink tik JSON:
{
  "manufacturer": "string|null",
  "country": "string|null",
  "pickupAddress": "string|null",
  "pickupReference": "string|null",
  "weightKg": number|null,
  "volumeM3": number|null,
  "cargoValue": number|null,
  "comments": "string",
  "confidence": number,
  "missingFields": ["manufacturer","country","pickupAddress","weightKg","volumeM3","cargoValue"]
}

Taisyklės:
- manufacturer: gamintojas / tiekėjas iš krovinio (laiškas ar priedai), ne logistikos siuntėjas.
- country: šalis, kur pakrovimas / gamintojas (adresas laiške ar PDF/XLS), ne siuntėjo šalis.
- pickupAddress: pilnas pakrovimo adresas iš turinio ar priedų.
- pickupReference: visi gamintojo/tiekėjo nurodyti numeriai, reikalingi kroviniui atiduoti sandėlyje / paėmimui: užsakymo nr., pickup reference, order number, ticket ID, eilutėse „Pickup references“, „Order no.“, sąskaitose ir pan. Kelis numerius jungk kableliu arba kabliataškiu. SVARBU: čia NERA vidinio logistikos sistemos numerio formatu TU#xxxx — tokio gamintojas nesiunčia; neįrašyk mūsų vidinių kodų. Jei nerandi — null.
- Speciali taisyklė Furninova: jei priede yra antraštė „Lista zaladunkowa nr ...“, pickupReference privalo būti būtent tas antraštės numeris (pvz. 25W/51/2/EXPO), net jei lentelėse yra daug kitų kodų.

Kontekstas (siuntėjas gali būti tik tarpininkas — jo nenaudok šaliai):
Tema: ${input.subject}
Siuntėjas (tik kontekstui): ${input.fromName} <${input.fromAddress}>

Laiško tekstas:
---
${body.slice(0, 18000)}
---
Priedų tekstas (iš PDF/Excel nuskaityta):
---
${att.slice(0, 60000)}
---`;

  try {
    const result = await model.generateContent(prompt);
    const raw = result.response.text().trim();
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("No JSON");
    const j = JSON.parse(m[0]) as Record<string, unknown>;
    const manufacturer =
      typeof j.manufacturer === "string" && j.manufacturer.trim()
        ? j.manufacturer.trim()
        : fallbackManufacturerFromBody(body);
    const country =
      typeof j.country === "string" && j.country.trim()
        ? j.country.trim()
        : fallbackCountryFromMailContent(body, input.subject, att);
    const pickupAddress =
      typeof j.pickupAddress === "string" && j.pickupAddress.trim()
        ? j.pickupAddress.trim()
        : null;
    const pickupReferenceRaw =
      typeof j.pickupReference === "string" && j.pickupReference.trim()
        ? j.pickupReference.trim().slice(0, 2000)
        : null;
    const pickupReference = preferFurninovaReference(
      manufacturer,
      input.subject,
      body,
      att,
      pickupReferenceRaw,
    );
    const missing = Array.isArray(j.missingFields)
      ? j.missingFields.filter((x) => typeof x === "string") as string[]
      : [];
    const reviewRequired = missing.length > 0 || !pickupAddress;
    const notes = reviewRequired
      ? `Trūksta laukų: ${missing.join(", ") || "pickupAddress"}`
      : null;
    return {
      manufacturer,
      country,
      pickupAddress: pickupAddress ?? "Adresas laiške",
      pickupReference,
      weightKg: toNumber(j.weightKg),
      volumeM3: toNumber(j.volumeM3),
      cargoValue: toNumber(j.cargoValue),
      shipperComment: [
        `Tema: ${input.subject}`,
        `Nuo: ${input.fromAddress}`,
        "---",
        typeof j.comments === "string" ? j.comments : body,
      ]
        .join("\n")
        .slice(0, 50000),
      parsedConfidence: toNumber(j.confidence),
      reviewRequired,
      reviewNotes: notes,
    };
  } catch (err) {
    const hint = err instanceof Error ? err.message : String(err);
    const short =
      hint.length > 220 ? `${hint.slice(0, 220)}…` : hint;
    return {
      manufacturer: fallbackManufacturerFromBody(body),
      country: fallbackCountryFromMailContent(body, input.subject, att),
      pickupAddress: body.split(/\r?\n/).find((l) => l.trim()) ?? "Adresas laiške",
      pickupReference: null,
      weightKg: null,
      volumeM3: null,
      cargoValue: null,
      shipperComment: [`Tema: ${input.subject}`, `Nuo: ${input.fromAddress}`, "---", body]
        .join("\n")
        .slice(0, 50000),
      parsedConfidence: null,
      reviewRequired: true,
      reviewNotes: `AI klaida (${geminiModelName()}): ${short}. Patikrinkite raktą, modelį (GEMINI_MODEL) ir kvotą.`,
    };
  }
}

export function normalizeBodyText(contentType: string | undefined, content: string): string {
  if (contentType?.toLowerCase() === "html") return stripHtml(content);
  return content.trim();
}

