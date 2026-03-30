import { GoogleGenerativeAI } from "@google/generative-ai";
import { geminiModelName } from "@/lib/gemini-model";

export type ParsedOffer = {
  priceEur: number | null;
  termText: string | null;
  termDays: number | null;
  vatNote: string | null;
};

/**
 * Ištraukia kainą ir terminą iš vežėjo laiško (kaip n8n „Atsakymai“).
 */
export async function parseCarrierReplyBody(bodyText: string): Promise<ParsedOffer> {
  const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!key) {
    return {
      priceEur: null,
      termText: null,
      termDays: null,
      vatNote: null,
    };
  }

  const genAI = new GoogleGenerativeAI(key);
  const model = genAI.getGenerativeModel({ model: geminiModelName() });

  const prompt = `Iš šio vežėjo pasiūlymo teksto ištrauk duomenis. Atsakyk TIK JSON vienoje eilutėje, be markdown:
{"priceEur": skaičius arba null, "termText": "trumpas termino aprašymas", "termDays": skaičius (apytikslės dienos, pvz. "2-3 d." -> 2.5), "vatNote": "su PVM" arba "be PVM" arba null}

Tekstas:
---
${bodyText.slice(0, 12000)}
---`;

  try {
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { priceEur: null, termText: null, termDays: null, vatNote: null };
    }
    const j = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    const priceRaw = j.priceEur;
    const priceEur =
      typeof priceRaw === "number"
        ? priceRaw
        : typeof priceRaw === "string"
          ? parseFloat(priceRaw.replace(",", "."))
          : null;
    const termDays =
      typeof j.termDays === "number"
        ? j.termDays
        : typeof j.termDays === "string"
          ? parseFloat(j.termDays.replace(",", "."))
          : null;
    return {
      priceEur: Number.isFinite(priceEur as number) ? (priceEur as number) : null,
      termText: typeof j.termText === "string" ? j.termText : null,
      termDays: Number.isFinite(termDays as number) ? (termDays as number) : null,
      vatNote: typeof j.vatNote === "string" ? j.vatNote : null,
    };
  } catch {
    return { priceEur: null, termText: null, termDays: null, vatNote: null };
  }
}
