import { GoogleGenerativeAI } from "@google/generative-ai";
import { geminiModelName } from "@/lib/gemini-model";

type OrderPayload = {
  internalId: string;
  manufacturer: string;
  country: string;
  pickupAddress: string;
  weightKg: number | null;
  volumeM3: number | null;
  shipperComment: string;
  /** Iš gamintojo laiško / priedų; ne TU# */
  pickupReference: string;
};

export async function generateCarrierEmailHtml(order: OrderPayload): Promise<string> {
  const key = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!key) {
    throw new Error("Trūksta GOOGLE_GENERATIVE_AI_API_KEY .env faile");
  }

  const genAI = new GoogleGenerativeAI(key);
  const model = genAI.getGenerativeModel({ model: geminiModelName() });

  const prompt = `Esi logistikos vadybininkas vardu Tomas. Paruošk oficialią pervežimo užklausą vežėjams LIETUVIŲ kalba. Nerašyk per kiek laiko norima gauti atsakymą, nebent tai aiškiai nurodyta komentaruose.

PIRMA EILUTĖ (būtina): pradėk nuo šios pastabos kursyvu (naudok HTML <i>...</i>):
SVARBU: Tai yra automatinė užklausų sistema. Prašome atsakyti tiesiogiai į šį laišką. Jei rašysite naują laišką, temos lauke nurodykite užsakymo numerį (pvz. ${order.internalId}).

Toliau tuščia eilutė, tada pasisveikink: "Sveiki, prašome pateikti pasiūlymą pervežimui:"

Krovos duomenys (tik faktai, kaip žemiau):

Pakrovimo adresas: ${order.pickupAddress}

Svoris: ${order.weightKg ?? "—"} kg

Tūris: ${order.volumeM3 ?? "—"} m³

Vidinis užsakymo Nr. (mūsų sistema, korespondencijai su jumis): ${order.internalId}

Paėmimo / užsakymo numeriai: ${order.pickupReference?.trim() || "—"}

Komentarai iš gamintojo: iš šaltinio teksto ištrauk TIK tai, ko nėra aukščiau (ne kartok adreso, svorio, tūrio, gamintojo numerių jei jie jau eilutėje „Paėmimo / užsakymo numeriai“). Pašalink el. pašto metaduomenis (tema, siuntėjas). Niekada nevadink vidinio ${order.internalId} „pasikrovimo numeriu“ gamintojo prasme — tai tik mūsų vidinis kodas. Tonas turi būti neutralus, mandagus, be griežtų formuluočių.

ŠALTINIS KOMENTARUI:
${order.shipperComment || "—"}

Paprašyk, kad nurodydami kainą vežėjai būtinai patikslintų, ar kaina su PVM, ar be PVM. Taip pat paprašyk nurodyti terminus.

Po to PRIVALOMAI pridėk:

Pristatymo adresas:

UAB ExpoDesign (sąskaita ant UAB ExpoDesign)

Panerių g. 56

Vilnius, LT-03202

Lithuania

Antanas +370 640 40441

I-V – 8:00 – 16:00 val.

(Pagal nutylėjimą – krovinius pristatyti/paimti į sandėlį su liftine mašina)

Prieš atvykstant, būtinai pasiskambinkite sandėlio vadovui Antanui +370 640 40441 (bent jau valandą prieš atvykstant).

Iš anksto dėkoju

SVARBU pastabą dėk TIK viršuje (kaip nurodyta), pakartojimo pabaigoje nereikia.

Rašyk mandagiai. Gamintojas / šalis kontekstui: ${order.manufacturer}, ${order.country}. Išvestį formatuok kaip HTML pastraipas (<p>), ne Markdown.`;

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  return text
    .replace(/\*\*(.*?)\*\*/g, "<b>$1</b>")
    .replace(/\n/g, "<br>");
}
