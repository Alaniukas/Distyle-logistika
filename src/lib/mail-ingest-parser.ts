import "@/lib/node-dom-polyfills";
import mammoth from "mammoth";
// pdf-parse v2 rekomenduoja importuoti worker prieš pagrindinį modulį (polyfill/CanvasFactory).
import { CanvasFactory } from "pdf-parse/worker";
import { PDFParse } from "pdf-parse";
import * as XLSX from "xlsx";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { geminiModelName } from "@/lib/gemini-model";
import { isForwardSubject } from "@/lib/inbound-mail-rules";
import {
  extractBoliaPalletDimensions,
  extractSabaPickupAddress,
  isBoliaContext,
  isSabaContext,
} from "@/lib/manufacturer-mail-extract";
import { mailHasStrongPickupSignals } from "@/lib/mail-pickup-intent";
import { computePackingListValidated } from "@/lib/order-quantity-validation";
import {
  packingListOrderRefsJoined,
  serializePackingListParse,
  type PackingListParse,
} from "@/lib/packing-list-parser";
import { findManufacturerInboundRule } from "@/lib/manufacturer-inbound-rules";
import {
  resolveOrderCountry,
  resolveOrderManufacturer,
} from "@/lib/parsed-order-sanitize";

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
  palletDimensions: string | null;
  /** Užsakymo / paėmimo nuorodos iš gamintojo laiško ar priedų (ne vidinis TU#) */
  pickupReference: string | null;
  weightKg: number | null;
  volumeM3: number | null;
  cargoValue: number | null;
  shipperComment: string;
  parsedConfidence: number | null;
  reviewRequired: boolean;
  reviewNotes: string | null;
  packingListBreakdownJson: string | null;
  packingListValidated: boolean;
};

const EMPTY_PACKING_FIELDS = {
  packingListBreakdownJson: null as string | null,
  packingListValidated: false,
};

function decodeB64(b64: string): Buffer {
  return Buffer.from(b64, "base64");
}

function stripHtml(html: string): string {
  let t = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
  return t
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/ *\n */g, "\n")
    .trim();
}

async function parsePdf(buffer: Buffer): Promise<string> {
  try {
    const parser = new PDFParse({ data: new Uint8Array(buffer), CanvasFactory });
    const textResult = await parser.getText();
    await parser.destroy();
    return textResult.text?.trim() || "";
  } catch (e) {
    if (process.env.MAIL_PDF_DEBUG === "true") {
      const msg = e instanceof Error ? e.message : String(e);
      // eslint-disable-next-line no-console
      console.warn("parsePdf failed:", msg);
    }
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

type ParsedOrderCore = Omit<
  ParsedOrderData,
  "packingListBreakdownJson" | "packingListValidated"
> &
  Partial<Pick<ParsedOrderData, "packingListBreakdownJson" | "packingListValidated">>;

function applyManufacturerHeuristics(
  parsed: ParsedOrderCore,
  subject: string,
  body: string,
  attachmentText: string,
): ParsedOrderData {
  const block = `${body}\n${attachmentText}`;
  let pickupAddress = parsed.pickupAddress;
  let palletDimensions = parsed.palletDimensions ?? "";

  if (isSabaContext(parsed.manufacturer, subject, block)) {
    const sabaAddr = extractSabaPickupAddress(block);
    if (sabaAddr) pickupAddress = sabaAddr;
  }

  if (isBoliaContext(parsed.manufacturer, subject, block)) {
    const dims = extractBoliaPalletDimensions(block);
    if (dims) palletDimensions = dims;
  }

  const hasGoodAddr = Boolean(
    pickupAddress && pickupAddress !== "Adresas laiške" && pickupAddress.length >= 12,
  );
  let reviewRequired = parsed.reviewRequired;
  let reviewNotes = parsed.reviewNotes;
  if (hasGoodAddr && /^Trūksta laukų:\s*pickupAddress\s*$/i.test(reviewNotes ?? "")) {
    reviewRequired = false;
    reviewNotes = null;
  } else if (!hasGoodAddr) {
    reviewRequired = true;
  }

  return {
    ...EMPTY_PACKING_FIELDS,
    ...parsed,
    pickupAddress: pickupAddress ?? parsed.pickupAddress,
    palletDimensions: palletDimensions || parsed.palletDimensions,
    packingListBreakdownJson:
      parsed.packingListBreakdownJson ?? EMPTY_PACKING_FIELDS.packingListBreakdownJson,
    packingListValidated:
      parsed.packingListValidated ?? EMPTY_PACKING_FIELDS.packingListValidated,
    reviewRequired,
    reviewNotes,
  };
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

export { tryExtractPackingListFromAttachments } from "@/lib/packing-list-parser";

function pickupReferenceFromPackingList(pl: PackingListParse, fallback: string | null): string {
  const joined = packingListOrderRefsJoined(pl.lines);
  if (joined) return joined;
  if (pl.pickupReferenceHint?.trim()) return pl.pickupReferenceHint.trim();
  return fallback ?? "";
}

type FinalizeContext = {
  subject: string;
  body: string;
  att: string;
  fromName: string;
  inboundRule: ReturnType<typeof findManufacturerInboundRule>;
};

function sanitizeParsedFields(parsed: ParsedOrderData, ctx: FinalizeContext): ParsedOrderData {
  const mailBlock = `${ctx.body}\n${ctx.att}`;
  return {
    ...parsed,
    manufacturer: resolveOrderManufacturer(
      parsed.manufacturer,
      ctx.subject,
      mailBlock,
      ctx.inboundRule,
      ctx.fromName,
    ),
    country: resolveOrderCountry(parsed.country, ctx.subject, mailBlock),
  };
}

function applyPackingListToParsed(
  parsed: ParsedOrderData,
  pl: PackingListParse,
  inboundRule: ReturnType<typeof findManufacturerInboundRule>,
): ParsedOrderData {
  const packingListBreakdownJson = serializePackingListParse(pl);
  const weightKg = pl.totals.grossKg;
  const volumeM3 = pl.totals.volumeM3;
  const pickupReference = pickupReferenceFromPackingList(pl, parsed.pickupReference);
  const packingListValidated = computePackingListValidated({
    weightKg,
    volumeM3,
    packingListBreakdownJson,
  });

  let reviewNotes = parsed.reviewNotes;
  if (pl.warnings.length > 0) {
    reviewNotes = [reviewNotes, ...pl.warnings].filter(Boolean).join("; ");
  }

  const hasGoodAddr = Boolean(
    parsed.pickupAddress &&
      parsed.pickupAddress !== "Adresas laiške" &&
      parsed.pickupAddress.length >= 12,
  );

  let reviewRequired = parsed.reviewRequired;
  if (packingListValidated && hasGoodAddr && pl.warnings.length === 0) {
    reviewRequired = false;
    if (/^Trūksta laukų:/i.test(reviewNotes ?? "")) {
      reviewNotes = null;
    }
  } else if (!hasGoodAddr) {
    reviewRequired = true;
    const who = inboundRule?.name ?? "gamintojo";
    reviewNotes = reviewNotes
      ? `${reviewNotes}; Trūksta pakrovimo adreso (${who})`
      : `Trūksta pakrovimo adreso (${who})`;
  }

  return {
    ...parsed,
    weightKg,
    volumeM3,
    pickupReference: pickupReference || parsed.pickupReference,
    packingListBreakdownJson,
    packingListValidated,
    reviewRequired,
    reviewNotes,
    parsedConfidence: parsed.parsedConfidence ?? (packingListValidated ? 0.95 : 0.85),
  };
}

function finalizeParsedOrder(
  parsed: ParsedOrderCore,
  ctx: FinalizeContext,
  packingList?: PackingListParse | null,
): ParsedOrderData {
  const base: ParsedOrderData = {
    ...EMPTY_PACKING_FIELDS,
    ...parsed,
    packingListBreakdownJson:
      parsed.packingListBreakdownJson ?? EMPTY_PACKING_FIELDS.packingListBreakdownJson,
    packingListValidated:
      parsed.packingListValidated ?? EMPTY_PACKING_FIELDS.packingListValidated,
  };
  const withPl = packingList
    ? applyPackingListToParsed(base, packingList, ctx.inboundRule ?? null)
    : base;
  return sanitizeParsedFields(withPl, ctx);
}

export async function parseOrderFromMailSources(input: {
  fromName: string;
  fromAddress: string;
  subject: string;
  bodyText: string;
  attachmentTexts: string[];
  packingList?: PackingListParse | null;
}): Promise<ParsedOrderData> {
  const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  const body = input.bodyText.trim();
  const att = input.attachmentTexts.join("\n\n");
  const inboundRule = findManufacturerInboundRule(
    input.fromAddress ?? input.fromName,
    input.subject,
  );
  const structuredHint = input.packingList
    ? `\n- SVARBU: Svoris (weightKg), tūris (volumeM3) ir užsakymų numeriai jau ištraukti struktūriškai iš priedo (${input.packingList.format}) — nekeisk šių skaičių.\n`
    : "";
  const finalizeCtx: FinalizeContext = {
    subject: input.subject,
    body,
    att,
    fromName: input.fromName,
    inboundRule,
  };

  if (!key) {
    const base = {
      manufacturer: resolveOrderManufacturer(null, input.subject, `${body}\n${att}`, inboundRule, input.fromName),
      country: resolveOrderCountry(inboundRule?.countryHint ?? null, input.subject, `${body}\n${att}`),
      pickupAddress: "Adresas laiške",
      palletDimensions: extractBoliaPalletDimensions(`${body}\n${att}`),
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
    return finalizeParsedOrder(
      applyManufacturerHeuristics(base, input.subject, body, att),
      finalizeCtx,
      input.packingList,
    );
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
- pickupAddress: pilnas pakrovimo adresas iš turinio ar priedų. Saba Italia: eilutės po „SABA ITALIA SRL“ (gatvė, CAP+miestas) iki „Warehouse hours“ / „Loading Details“.
- Jei Bolia laiške yra palečių matmenys (WxLxH, pvz. „145 x 95 x 120 cm“) — įrašyk į comments, bet struktūriškai jie bus ištraukti atskirai.
- pickupReference: visi gamintojo/tiekėjo nurodyti numeriai, reikalingi kroviniui atiduoti sandėlyje / paėmimui: užsakymo nr., pickup reference, order number, ticket ID, eilutėse „Pickup references“, „Order no.“, sąskaitose ir pan. Kelis numerius jungk kableliu arba kabliataškiu. SVARBU: čia NERA vidinio logistikos sistemos numerio formatu TU#xxxx — tokio gamintojas nesiunčia; neįrašyk mūsų vidinių kodų. Jei nerandi — null.
- Speciali taisyklė Furninova: jei priede yra antraštė „Lista zaladunkowa nr ...“, pickupReference privalo būti būtent tas antraštės numeris (pvz. 25W/51/2/EXPO), net jei lentelėse yra daug kitų kodų.
${structuredHint}
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
        : null;
    const country =
      typeof j.country === "string" && j.country.trim() ? j.country.trim() : null;
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
    return finalizeParsedOrder(
      applyManufacturerHeuristics(
        {
          manufacturer,
          country,
          pickupAddress: pickupAddress ?? "Adresas laiške",
          palletDimensions: null,
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
        },
        input.subject,
        body,
        att,
      ),
      finalizeCtx,
      input.packingList,
    );
  } catch (err) {
    const hint = err instanceof Error ? err.message : String(err);
    const short =
      hint.length > 220 ? `${hint.slice(0, 220)}…` : hint;
    return finalizeParsedOrder(
      applyManufacturerHeuristics(
        {
        manufacturer: null,
        country: inboundRule?.countryHint ?? null,
          pickupAddress: "Adresas laiške",
          palletDimensions: null,
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
        },
        input.subject,
        body,
        att,
      ),
      finalizeCtx,
      input.packingList,
    );
  }
}

export function normalizeBodyText(contentType: string | undefined, content: string): string {
  if (contentType?.toLowerCase() === "html") return stripHtml(content);
  return content.trim();
}

export type GraphBodyField = {
  contentType?: string;
  content?: string;
};

/** Graph: uniqueBody = tik šio laiško dalis (be cituotos gijos) — Outlook RE. */
export function resolveGraphMessageText(input: {
  body?: GraphBodyField | null;
  uniqueBody?: GraphBodyField | null;
  bodyPreview?: string | null;
}): { fullBody: string; ingestBody: string; bodySource: "uniqueBody" | "body" | "preview" } {
  const fromPart = (part: GraphBodyField | null | undefined): string => {
    if (!part?.content?.trim()) return "";
    return normalizeBodyText(part.contentType, part.content);
  };

  const unique = fromPart(input.uniqueBody);
  const full = fromPart(input.body);
  const preview = input.bodyPreview?.trim() ?? "";

  const fullBody = full || preview || "(tuščias tekstas)";
  if (unique.length >= 15) {
    return { fullBody, ingestBody: unique, bodySource: "uniqueBody" };
  }
  if (full.length > 0) {
    return { fullBody, ingestBody: full, bodySource: "body" };
  }
  return { fullBody, ingestBody: preview || "(tuščias tekstas)", bodySource: "preview" };
}

const QUOTE_CUT_MARKERS: RegExp[] = [
  /^\s*-{2,}\s*forwarded message\s*-{2,}\s*$/i,
  /^\s*from:\s+/i,
  /^\s*sent:\s+/i,
  /^\s*to:\s+/i,
  /^\s*cc:\s+/i,
  /^\s*subject:\s+/i,
  /^\s*(da|inviato|oggetto|a):\s+/i,
  /^\s*(on|w dniu|le|il|el|am)\b.*\b(wrote|schrieb|napisał|ha scritto|ra(?:š|s)ė)\s*:?\s*$/i,
];

/**
 * Paima tik „naują“ laiško dalį ir nukerpa cituotas istorijas (reply/forward),
 * kad AI neimtų senų gijų tekstų kaip naujo užsakymo konteksto.
 */
export function trimQuotedMailHistory(text: string): string {
  const lines = text.replace(/\r/g, "").split("\n");
  const cleaned: string[] = [];
  for (const line of lines) {
    const l = line.trimEnd();
    if (l.trimStart().startsWith(">")) continue;
    if (QUOTE_CUT_MARKERS.some((re) => re.test(l))) break;
    cleaned.push(l);
  }
  const joined = cleaned.join("\n").trim();
  // Jei per agresyviai nukirpome beveik viską, paliekam originalą.
  if (joined.length >= 80) return joined;
  return text.trim();
}

/**
 * Peradresavimuose (FW) duomenys dažnai būna po „From:“ — trimQuotedMailHistory juos nukerta.
 * Jei po kirpimo nebelieka paėmimo signalų, bet pilname tekste yra — naudojame pilną tekstą.
 */
export function bodyTextForIngest(
  subject: string,
  fullText: string,
  attachmentNames: string[] = [],
  options?: { fromUniqueBody?: boolean },
): string {
  const full = fullText.trim() || "(tuščias tekstas)";
  if (options?.fromUniqueBody) {
    return trimQuotedMailHistory(full);
  }
  const trimmed = trimQuotedMailHistory(full);
  if (!isForwardSubject(subject)) return trimmed;
  const trimmedHas = mailHasStrongPickupSignals(subject, trimmed, attachmentNames);
  const fullHas = mailHasStrongPickupSignals(subject, full, attachmentNames);
  if (!trimmedHas && fullHas) return full;
  if (trimmed.length < 160 && full.length > trimmed.length + 80) return full;
  return trimmed;
}

