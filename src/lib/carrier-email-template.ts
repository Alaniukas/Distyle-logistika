import {
  parsePackingListJson,
  type PackingListFormat,
  type PackingListParse,
} from "@/lib/packing-list-parser";

const PACKING_LIST_FORMAT_LABEL: Record<PackingListFormat, string> = {
  saba: "Saba",
  furninova: "Furninova",
  bolia: "Bolia",
  generic: "Packing list",
};

/**
 * Numatytasis vežėjų laiško HTML (pagal n8n „Vėžėjai“ struktūrą, be AI).
 * Vartotojas gali redaguoti prieš siunčiant.
 */
export type OrderForTemplate = {
  internalId: string;
  manufacturer: string;
  country: string;
  pickupAddress: string;
  /** Palečių matmenys (Bolia ir pan.) */
  palletDimensions?: string;
  weightKg: number | null;
  volumeM3: number | null;
  shipperComment: string;
  /** Gamintojo / laiške ir prieduose nurodytos paėmimo nuorodos — ne vidinis TU# */
  pickupReference: string;
  packingListBreakdownJson?: string | null;
};

export function packingListFromOrder(order: OrderForTemplate): PackingListParse | null {
  return parsePackingListJson(order.packingListBreakdownJson);
}

function buildPackingListTableHtml(breakdown: PackingListParse): string {
  const formatLabel = PACKING_LIST_FORMAT_LABEL[breakdown.format] ?? "Packing list";
  const rows = breakdown.lines
    .map(
      (l) =>
        `<tr><td>${escapeHtml(l.orderRef)}</td><td>${escapeHtml(l.label ?? "—")}</td><td>${l.boxes}</td><td>${escapeHtml(String(Math.round(l.volumeM3 * 1000) / 1000))}</td><td>${escapeHtml(String(Math.round(l.grossKg * 10) / 10))}</td></tr>`,
    )
    .join("");
  const t = breakdown.totals;
  return `<p><b>${escapeHtml(formatLabel)} — skaidymas pagal užsakymą:</b></p>
<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;font-size:13px;">
<thead><tr><th>Užsakymas</th><th>Segmentas</th><th>Dėžės</th><th>m³</th><th>Bruto kg</th></tr></thead>
<tbody>${rows}</tbody>
<tfoot><tr><td colspan="2"><b>Viso</b></td><td><b>${t.boxes}</b></td><td><b>${Math.round(t.volumeM3 * 1000) / 1000}</b></td><td><b>${Math.round(t.grossKg * 10) / 10}</b></td></tr></tfoot>
</table>`;
}

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
  const pallets = order.palletDimensions?.trim();

  const pickupRef = (order.pickupReference?.trim() || "").replace(
    new RegExp(order.internalId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"),
    "",
  ).replace(/^[;,.\s]+|[;,.\s]+$/g, "").trim();

  const pl = packingListFromOrder(order);
  const plTable = pl ? `${buildPackingListTableHtml(pl)}<br>` : "";

  return `${automationNoticeHtml(order.internalId)}
<p>Sveiki, prašome pateikti pasiūlymą pervežimui:</p>
<p><b>Krovos duomenys</b></p>
<p>Pakrovimo adresas: ${escapeHtml(order.pickupAddress)}<br><br>
${pallets ? `Palečių matmenys: ${escapeHtml(pallets)}<br><br>` : ""}
Svoris: ${escapeHtml(w)} kg<br><br>
Tūris: ${escapeHtml(v)} m³<br><br>
Paėmimo / užsakymo numeriai (gamintojo): ${escapeHtml(pickupRef || "—")}</p>
${plTable}
<p>Komentarai iš gamintojo: ${escapeHtml(comment)}</p>
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
<p>Iš anksto dėkoju.</p>
<p><i>Užsakymo numeris atsakymui: <b>${escapeHtml(order.internalId)}</b></i></p>`;
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
