import { GoogleGenerativeAI } from "@google/generative-ai";
import { geminiModelName } from "@/lib/gemini-model";

export type PickupIntentInput = {
  subject: string;
  bodyText: string;
  attachmentNames: string[];
};

export type PickupIntentResult = {
  importOrder: boolean;
  reason: string;
};

/**
 * Ar laiškas apie krovinio paėmimą / paruošimą vežėjui (adresas, loading list, pickup ref),
 * o ne vidinis statusų atnaujinimas, gamybos vėlavimai be logistikos ir pan.
 * Paleidžiama prieš sunkų PDF/AI parsingą — tik tema + tekstas + priedų vardai.
 */
export async function classifyMailPickupIntent(
  input: PickupIntentInput,
): Promise<PickupIntentResult> {
  if (process.env.MAIL_PICKUP_AI_DISABLED === "true") {
    return { importOrder: true, reason: "MAIL_PICKUP_AI_DISABLED" };
  }

  const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
  if (!key) {
    if (process.env.MAIL_PICKUP_AI_STRICT === "true") {
      return {
        importOrder: false,
        reason: "nėra GOOGLE_GENERATIVE_AI_API_KEY (MAIL_PICKUP_AI_STRICT)",
      };
    }
    return { importOrder: true, reason: "be DI vartų (nėra API rakto)" };
  }

  const names =
    input.attachmentNames.length > 0
      ? input.attachmentNames.join(", ")
      : "(nėra priedų)";
  const body = input.bodyText.trim().slice(0, 14000);

  const genAI = new GoogleGenerativeAI(key);
  const model = genAI.getGenerativeModel({
    model: geminiModelName(),
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json",
    },
  });

  const prompt = `Tu esi logistikos triažo asistentas. Turi nuspręsti, ar šį el. laišką verta įkelti į užsakymų sistemą kaip KROVINIO PAĖMIMO / PARUOŠIMO VEŽĖJUI užduotį.

ĮKELTI (importOrder: true), jei laiškas PAGRINDINIAI apie:
- prekes paruoštas paėmimui / paruošimas pakrovimui, loading list, packing list, pick-up reference, pick up address;
- konkretų pakrovimo adresą, sandėlio laiką, matmenis/svorį PAĖMIMUI;
- bilietą / užsakymą vežėjui nuvažiuoti pasiimti krovinį.

NEĮKELTI (importOrder: false), jei tai:
- vidinis gamybos / terminų atnaujinimas („už 3 d.“, „patikrinkite statusus“, vėlavimai be konkretaus paėmimo logistikos);
- bendras susirašinėjimas be paėmimo adreso ir be paruošto krovinio paėmimo prasmės;
- tik sąskaita / pasiūlymas be „ready for collection“ konteksto (nebent aiškiai paruošta pakrovimui).

Priedų vardai (gali būti indikatorius: PDF packing list, loading list ir pan.): ${names}

Grąžink TIK JSON:
{"importOrder": true arba false, "reason": "viena trumpa sakiniu LT priežastis"}

Tema: ${input.subject}

Laiško tekstas:
---
${body}
---`;

  try {
    const result = await model.generateContent(prompt);
    const raw = result.response.text().trim();
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("No JSON");
    const j = JSON.parse(m[0]) as Record<string, unknown>;
    const importOrder =
      j.importOrder === true || j.shouldImport === true || j.import === true;
    const reason =
      typeof j.reason === "string" && j.reason.trim()
        ? j.reason.trim().slice(0, 500)
        : importOrder
          ? "DI: tinkamas paėmimui"
          : "DI: netinkamas";
    return { importOrder, reason };
  } catch {
    if (process.env.MAIL_PICKUP_AI_FAIL_OPEN === "true") {
      return {
        importOrder: true,
        reason: "DI klaida — leidžiama importuoti (MAIL_PICKUP_AI_FAIL_OPEN)",
      };
    }
    return {
      importOrder: false,
      reason: "DI klasifikatoriaus klaida — praleista (sukurkite užsakymą ranka jei reikia)",
    };
  }
}
