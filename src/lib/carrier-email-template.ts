/**
 * Numatytasis vežėjų laiško HTML (pagal n8n „Vėžėjai“ struktūrą, be AI).
 * Vartotojas gali redaguoti prieš siunčiant.
 */
export type OrderForTemplate = {
  internalId: string;
  manufacturer: string;
  country: string;
  pickupAddress: string;
  weightKg: number | null;
  volumeM3: number | null;
  shipperComment: string;
  /** Gamintojo / laiške ir prieduose nurodytos paėmimo nuorodos — ne vidinis TU# */
  pickupReference: string;
};

export function carrierEmailSubject(order: OrderForTemplate): string {
  return `Pervežimo paslaugai ${order.country} (${order.manufacturer}) – Lietuva, ID: ${order.internalId}`;
}

export type BuildCarrierEmailOptions = {
  /** Jei nenurodyta, naudojamas shipperComment (neišpoliruotas). */
  additionalNotes?: string;
};

function automationNoticeHtml(internalId: string): string {
  return `<p><i>SVARBU: Tai yra automatinė užklausų sistema. Prašome atsakyti tiesiogiai į šį laišką. Jei rašysite naują laišką, temos lauke nurodykite užsakymo numerį (pvz. ${escapeHtml(internalId)}).</i></p>`;
}

export function buildDefaultCarrierEmailHtml(
  order: OrderForTemplate,
  opts?: BuildCarrierEmailOptions,
): string {
  const w = order.weightKg != null ? `${order.weightKg}` : "—";
  const v = order.volumeM3 != null ? `${order.volumeM3}` : "—";
  const comment =
    (opts?.additionalNotes?.trim() ??
      order.shipperComment?.trim() ??
      "") || "—";

  return `${automationNoticeHtml(order.internalId)}
<p>Sveiki, prašome pateikti pasiūlymą pervežimui:</p>
<p><b>Krovos duomenys</b></p>
<p>Pakrovimo adresas: ${escapeHtml(order.pickupAddress)}<br><br>
Svoris: ${escapeHtml(w)} kg<br><br>
Tūris: ${escapeHtml(v)} m³<br><br>
Komentarai iš gamintojo: ${escapeHtml(comment)}<br><br>
Vidinis užsakymo Nr. (mūsų sistema): ${escapeHtml(order.internalId)}<br><br>
Paėmimo / užsakymo numeriai: ${escapeHtml(
    order.pickupReference?.trim() || "—",
  )}</p>
<p>Prašome nurodyti kainą ir patikslinti, ar ji <b>su PVM</b>, ar <b>be PVM</b>, taip pat pristatymo / pakrovimo terminus.</p>
<p><b>Pristatymo adresas:</b></p>
<p>UAB ExpoDesign (sąskaita ant UAB ExpoDesign)<br>
Panerių g. 56<br>
Vilnius, LT-03202<br>
Lithuania<br>
Antanas +370 640 40441<br>
I-V – 8:00 – 16:00 val.</p>
<p>(Pagal nutylėjimą – krovinius pristatyti/paimti į sandėlį su liftine mašina.)</p>
<p>Prieš atvykstant, būtinai pasiskambinkite sandėlio vadovui Antanui +370 640 40441 (bent jau valandą prieš atvykstant).</p>
<p>Iš anksto dėkoju.</p>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildConfirmationEmailHtml(order: OrderForTemplate, carrierEmail: string): string {
  return `<p>Sveiki,</p>
<p>Patvirtiname užsakymą <b>${escapeHtml(order.internalId)}</b> jūsų pasiūlymui. Prašome organizuoti pervežimą pagal ankstesnę korespondenciją.</p>
<p>Vežėjas: ${escapeHtml(carrierEmail)}</p>
<p>Pagarbiai,<br>Logistikos komanda</p>`;
}

export function confirmationEmailSubject(order: OrderForTemplate): string {
  return `Patvirtinimas: ${order.internalId} – užsakymas priimtas`;
}
