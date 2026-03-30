import { GoogleGenerativeAI } from "@google/generative-ai";
import type { OrderForTemplate } from "@/lib/carrier-email-template";
import { geminiModelName } from "@/lib/gemini-model";

/**
 * Pašalina el. laiško metaduomenis iš komentaro (kai nėra AI rakto).
 */
export function stripShipperCommentMetadata(raw: string): string {
  const lines = raw.split(/\r?\n/);
  const kept: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (/^(Tema|Subject|Nuo|From)\s*:/i.test(t)) continue;
    if (/^---+$/u.test(t)) continue;
    kept.push(t);
  }
  const s = kept.join(" ").replace(/\s+/g, " ").trim();
  return s || "—";
}

/**
 * Paruošia „Kitą svarbią info“ vežėjams: LT, be dubliavimo su struktūriniais laukais.
 */
export async function polishAdditionalNotesForCarriers(
  order: OrderForTemplate,
): Promise<string> {
  const raw = (order.shipperComment || "").trim();
  if (!raw) return "—";

  const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!key) {
    return stripShipperCommentMetadata(raw);
  }

  try {
    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel({ model: geminiModelName() });

    const prompt = `Tu esi logistikos asistentas. Iš šaltinio teksto paruošk trumpą pastabą vežėjams LIETUVIŲ kalba.

JAU ŽINOMA ATSKIRAI (NEKARTOK ir neįtrauk į atsakymą):
- Pakrovimo adresas: ${order.pickupAddress}
- Svoris: ${order.weightKg ?? "—"} kg
- Tūris: ${order.volumeM3 ?? "—"} m³
- Gamintojo paėmimo/užsakymo nuorodos: ${order.pickupReference?.trim() || "—"}

ŠALTINIO TEKSTAS:
"""
${raw}
"""

TAISYKLĖS:
1. Parašyk tik operacinę informaciją: darbo laikus, ypatingas instrukcijas vairuotojui, neatitikimus tarp dokumentų – jei tai svarbu vežėjui. Jei paėmimo nuorodos jau pateiktos skiltyje „Gamintojo paėmimo/užsakymo nuorodos“ aukščiau – jų nekartok.
2. Neįtrauk: el. pašto temos, siuntėjo, „Tema:“, „Nuo:“ ir pan. metaduomenų.
3. Jei visa esmė jau padengta laukais aukščiau arba nieko nebelieka – atsakyk tik simboliu: —
4. Ne daugiau kaip 5 trumpi sakiniai. Be antraštės, be sąrašo žymų, grynas tekstas viename pastraipoje arba keliose trumpose.
5. Jei šaltinis anglų kalba – išversk į lietuvių.

Atsakymas (tik tekstas, be kabučių):`;

    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    const cleaned = text.replace(/^["']|["']$/g, "").trim();
    if (!cleaned || cleaned === "—" || cleaned === "-") return "—";
    return cleaned;
  } catch {
    return stripShipperCommentMetadata(raw);
  }
}
