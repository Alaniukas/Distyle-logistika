"use client";

import { offerValueScore, pickBestOfferId } from "@/lib/offer-score";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type SerializedOffer = {
  id: string;
  orderId: string;
  carrierEmail: string;
  bodyText: string;
  createdAt: string;
  priceEur: number | null;
  termText: string | null;
  termDays: number | null;
  vatNote: string | null;
  source: string;
  matchMethod: string | null;
};

export type SerializedOrder = {
  id: string;
  internalId: string;
  status: string;
  manufacturer: string;
  country: string;
  pickupAddress: string;
  weightKg: number | null;
  volumeM3: number | null;
  shipperComment: string;
  pickupReference: string;
  emailHtml: string | null;
  countryRoute: string | null;
  sentAt: string | null;
  source: string;
  emailSubject: string | null;
  attachmentNamesJson: string | null;
  reviewRequired: boolean;
  reviewNotes: string | null;
  parsedConfidence: number | null;
  cargoValue: number | null;
  createdAt: string;
  updatedAt: string;
  offers: SerializedOffer[];
};

type Props = {
  order: SerializedOrder;
};

function formatEur(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(2)} €`;
}

export function OrderActions({ order: initial }: Props) {
  const router = useRouter();
  const [order, setOrder] = useState(initial);
  const [offers, setOffers] = useState(initial.offers);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const [offerErr, setOfferErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [addingOffer, setAddingOffer] = useState(false);

  const [sendOpen, setSendOpen] = useState(false);
  const [draftHtml, setDraftHtml] = useState("");
  const [draftSubject, setDraftSubject] = useState("");
  const [draftTo, setDraftTo] = useState<string | null>(null);
  const [draftBcc, setDraftBcc] = useState<string[]>([]);
  const [sendEditMode, setSendEditMode] = useState(false);
  const [draftLoading, setDraftLoading] = useState(false);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [confirmHtml, setConfirmHtml] = useState("");
  const [confirmSubject, setConfirmSubject] = useState("");
  const [confirmEditMode, setConfirmEditMode] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [confirmSending, setConfirmSending] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const bestId = useMemo(
    () => pickBestOfferId(offers.map((o) => ({ id: o.id, priceEur: o.priceEur, termDays: o.termDays }))),
    [offers],
  );

  async function openSendModal() {
    setSendErr(null);
    setSendOpen(true);
    setSendEditMode(false);
    setDraftLoading(true);
    try {
      const res = await fetch(`/api/orders/${order.id}/draft`);
      if (!res.ok) throw new Error("Nepavyko įkelti šablono");
      const d = (await res.json()) as {
        html: string;
        subject: string;
        to?: string;
        bcc?: string[];
      };
      setDraftHtml(d.html);
      setDraftSubject(d.subject);
      setDraftTo(typeof d.to === "string" ? d.to : null);
      setDraftBcc(Array.isArray(d.bcc) ? d.bcc : []);
    } catch {
      setDraftHtml("");
      setDraftSubject("");
      setDraftTo(null);
      setDraftBcc([]);
      setSendErr("Nepavyko įkelti šablono");
    } finally {
      setDraftLoading(false);
    }
  }

  async function submitSend() {
    setSendErr(null);
    setSending(true);
    const res = await fetch(`/api/orders/${order.id}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ html: draftHtml, subject: draftSubject }),
    });
    setSending(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setSendErr(typeof j.error === "string" ? j.error : "Siuntimo klaida");
      return;
    }
    const data = await res.json();
    setOrder(data.order as SerializedOrder);
    setSendOpen(false);
    router.refresh();
  }

  async function addOffer(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setOfferErr(null);
    const fd = new FormData(e.currentTarget);
    setAddingOffer(true);
    const res = await fetch(`/api/orders/${order.id}/offers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        carrierEmail: fd.get("carrierEmail"),
        bodyText: fd.get("bodyText"),
      }),
    });
    setAddingOffer(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setOfferErr(typeof j.error === "string" ? j.error : "Klaida");
      return;
    }
    const offer = (await res.json()) as SerializedOffer;
    setOffers((prev) => [offer, ...prev]);
    e.currentTarget.reset();
    router.refresh();
  }

  async function openConfirm(carrierEmail: string) {
    setConfirmEmail(carrierEmail);
    setConfirmEditMode(false);
    setConfirmLoading(true);
    setConfirmOpen(true);
    try {
      const q = new URLSearchParams({ carrierEmail });
      const res = await fetch(`/api/orders/${order.id}/confirm-draft?${q}`);
      const j = await res.json();
      if (!res.ok) throw new Error("Klaida");
      setConfirmHtml(j.html as string);
      setConfirmSubject(j.subject as string);
    } catch {
      setConfirmHtml("");
      setConfirmSubject("");
    } finally {
      setConfirmLoading(false);
    }
  }

  async function submitConfirm() {
    setConfirmSending(true);
    const res = await fetch(`/api/orders/${order.id}/confirm-carrier`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        carrierEmail: confirmEmail,
        html: confirmHtml,
        subject: confirmSubject,
      }),
    });
    setConfirmSending(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(typeof j.error === "string" ? j.error : "Klaida");
      return;
    }
    setConfirmOpen(false);
    router.refresh();
  }

  async function deleteOrder() {
    if (
      !window.confirm(
        `Ištrinti užsakymą ${order.internalId}? Šio veiksmo negalima atšaukti.`,
      )
    ) {
      return;
    }
    setDeleting(true);
    const res = await fetch(`/api/orders/${order.id}`, { method: "DELETE" });
    setDeleting(false);
    if (!res.ok) {
      alert("Nepavyko ištrinti");
      return;
    }
    router.push("/orders");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-10">
      {sendOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-900">Laiškas vežėjams</h3>
            <p className="mt-1 text-sm text-slate-600">
              Patikrinkite tekstą ir temą. Pagal šalį automatiškai parenkamas gavėjas (žemiau).
            </p>
            {draftTo ? (
              <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-800">
                <span className="font-medium">Gavėjas:</span> {draftTo}
                {draftBcc.length > 0 ? (
                  <span className="block text-xs text-slate-600">
                    BCC kopija: {draftBcc.join(", ")}
                  </span>
                ) : null}
              </p>
            ) : null}
            {sendErr ? (
              <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{sendErr}</p>
            ) : null}
            {draftLoading ? (
              <p className="mt-4 text-sm text-slate-500">Kraunama…</p>
            ) : (
              <>
                <label className="mt-4 block text-xs font-medium text-slate-600">Tema</label>
                <input
                  value={draftSubject}
                  onChange={(e) => setDraftSubject(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
                <div className="mt-3 flex items-center justify-between gap-2">
                  <label className="text-xs font-medium text-slate-600">
                    {sendEditMode ? "Laiško tekstas (HTML)" : "Laiško peržiūra"}
                  </label>
                  <button
                    type="button"
                    onClick={() => setSendEditMode((v) => !v)}
                    className="text-xs font-medium text-blue-700 hover:underline"
                  >
                    {sendEditMode ? "Rodyti peržiūrą" : "Redaguoti HTML"}
                  </button>
                </div>
                {sendEditMode ? (
                  <textarea
                    value={draftHtml}
                    onChange={(e) => setDraftHtml(e.target.value)}
                    rows={16}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs"
                  />
                ) : (
                  <div
                    className="mt-1 max-h-[min(420px,50vh)] overflow-auto rounded-lg border border-slate-200 bg-white p-4 text-sm leading-relaxed text-slate-900 [&_b]:font-semibold [&_p]:my-2 [&_u]:underline"
                    dangerouslySetInnerHTML={{ __html: draftHtml || "<p>—</p>" }}
                  />
                )}
                <div className="mt-6 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setSendOpen(false)}
                    className="rounded-lg px-4 py-2 text-sm text-slate-700 hover:bg-slate-100"
                  >
                    Atšaukti
                  </button>
                  <button
                    type="button"
                    onClick={submitSend}
                    disabled={sending || !draftHtml.trim()}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {sending ? "Siunčiama…" : "Siųsti"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}

      {confirmOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-slate-900">Patvirtinimas vežėjui</h3>
            <p className="mt-1 text-sm text-slate-600">
              Gavėjas: <span className="font-medium">{confirmEmail}</span>
            </p>
            {confirmLoading ? (
              <p className="mt-4 text-sm">Kraunama…</p>
            ) : (
              <>
                <label className="mt-4 block text-xs font-medium text-slate-600">Tema</label>
                <input
                  value={confirmSubject}
                  onChange={(e) => setConfirmSubject(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
                <div className="mt-3 flex items-center justify-between gap-2">
                  <label className="text-xs font-medium text-slate-600">
                    {confirmEditMode ? "Tekstas (HTML)" : "Peržiūra"}
                  </label>
                  <button
                    type="button"
                    onClick={() => setConfirmEditMode((v) => !v)}
                    className="text-xs font-medium text-blue-700 hover:underline"
                  >
                    {confirmEditMode ? "Rodyti peržiūrą" : "Redaguoti HTML"}
                  </button>
                </div>
                {confirmEditMode ? (
                  <textarea
                    value={confirmHtml}
                    onChange={(e) => setConfirmHtml(e.target.value)}
                    rows={10}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs"
                  />
                ) : (
                  <div
                    className="mt-1 max-h-[min(360px,45vh)] overflow-auto rounded-lg border border-slate-200 bg-white p-4 text-sm leading-relaxed text-slate-900 [&_b]:font-semibold [&_p]:my-2 [&_u]:underline"
                    dangerouslySetInnerHTML={{ __html: confirmHtml || "<p>—</p>" }}
                  />
                )}
                <div className="mt-6 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmOpen(false)}
                    className="rounded-lg px-4 py-2 text-sm text-slate-700 hover:bg-slate-100"
                  >
                    Atšaukti
                  </button>
                  <button
                    type="button"
                    onClick={submitConfirm}
                    disabled={confirmSending}
                    className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {confirmSending ? "Siunčiama…" : "Siųsti patvirtinimą"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        {sendErr && !sendOpen ? (
          <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{sendErr}</p>
        ) : null}
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            <h2 className="shrink-0 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Siuntimas vežėjams
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex max-w-full items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  order.sentAt
                    ? "bg-emerald-100 text-emerald-900"
                    : "bg-slate-100 text-slate-700"
                }`}
                title={
                  order.sentAt
                    ? `Išsiųsta vežėjams: ${new Date(order.sentAt).toLocaleString("lt-LT")}`
                    : "Dar nebuvo siunčiama į vežėjų el. paštą"
                }
              >
                Vežėjams:{" "}
                {order.sentAt
                  ? `Išsiųsta · ${new Date(order.sentAt).toLocaleString("lt-LT", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}`
                  : "Neišsiųsta"}
              </span>
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  order.reviewRequired
                    ? "bg-amber-100 text-amber-900"
                    : "bg-emerald-50 text-emerald-900"
                }`}
              >
                Peržiūra: {order.reviewRequired ? "Reikia peržiūros" : "Paruošta"}
              </span>
            </div>
          </div>
          {order.status === "pending_review" ? (
            <button
              type="button"
              onClick={openSendModal}
              className="shrink-0 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
            >
              Siųsti vežėjams
            </button>
          ) : null}
        </div>
        {order.reviewRequired ? (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Reikia peržiūros prieš siuntimą.
            {order.reviewNotes ? ` ${order.reviewNotes}` : ""}
          </p>
        ) : null}
      </section>

      {order.emailHtml ? (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Išsiųsto laiško kopija
          </h2>
          <div
            className="mt-3 rounded-xl border border-slate-200 bg-white p-4 text-sm leading-relaxed [&_b]:font-semibold"
            dangerouslySetInnerHTML={{ __html: order.emailHtml }}
          />
        </section>
      ) : null}

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Vežėjų pasiūlymai
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Atsakymai iš el. pašto importuojami periodiškai (žr. vidinį sinchroną).
        </p>
        <details className="mt-3 rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2 text-sm text-slate-700">
          <summary className="cursor-pointer font-medium text-slate-800">
            Papildomai: įvesti pasiūlymą ranka
          </summary>
          <p className="mt-2 text-slate-600">
            Jei atsakymas atėjo telefonu, iš kito pašto ar sinchronas dar nepagavo — galite įrašyti čia.
          </p>
          <form onSubmit={addOffer} className="mt-3 flex flex-col gap-3 pb-1">
            {offerErr ? (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{offerErr}</p>
            ) : null}
            <input
              name="carrierEmail"
              required
              placeholder="Vežėjo el. paštas"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            />
            <textarea
              name="bodyText"
              required
              rows={3}
              placeholder="Pasiūlymo tekstas (kaina, terminai…)"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            />
            <button
              type="submit"
              disabled={addingOffer}
              className="w-fit rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-60"
            >
              {addingOffer ? "Saugoma…" : "Pridėti rankiniu būdu"}
            </button>
          </form>
        </details>

        <div className="mt-6 overflow-x-auto">
          {offers.length === 0 ? (
            <p className="text-sm text-slate-500">Pasiūlymų dar nėra.</p>
          ) : (
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2 pr-2">Vežėjas</th>
                  <th className="py-2 pr-2">Kaina</th>
                  <th className="py-2 pr-2">Terminas</th>
                  <th className="py-2 pr-2">Balas*</th>
                  <th className="py-2 pr-2">Susiejimas</th>
                  <th className="py-2 pr-2">Komentaras</th>
                  <th className="py-2">Veiksmai</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {offers.map((o) => {
                  const score = offerValueScore(o);
                  const isBest = bestId === o.id && score != null;
                  return (
                    <tr
                      key={o.id}
                      className={
                        isBest ? "bg-emerald-50/90 ring-1 ring-emerald-200" : "hover:bg-slate-50/80"
                      }
                    >
                      <td className="py-3 pr-2 align-top text-slate-800">
                        <div className="font-medium">{o.carrierEmail}</div>
                        <div className="text-xs text-slate-500">
                          {o.source === "email" ? "Iš pašto" : "Ranka"} ·{" "}
                          {new Date(o.createdAt).toLocaleString("lt-LT")}
                        </div>
                      </td>
                      <td className="py-3 pr-2 align-top">
                        {formatEur(o.priceEur)}
                        {o.vatNote ? (
                          <span className="ml-1 text-xs text-slate-500">({o.vatNote})</span>
                        ) : null}
                      </td>
                      <td className="py-3 pr-2 align-top text-slate-700">
                        {o.termText ?? "—"}
                        {o.termDays != null ? (
                          <span className="ml-1 text-xs text-slate-500">(~{o.termDays} d.)</span>
                        ) : null}
                      </td>
                      <td className="py-3 pr-2 align-top font-mono text-xs">
                        {score != null ? score.toFixed(2) : "—"}
                      </td>
                      <td className="py-3 pr-2 align-top text-xs text-slate-600">
                        {o.matchMethod === "thread"
                          ? "Gijos atsakymas"
                          : o.matchMethod === "tu"
                            ? "Pagal TU#"
                            : o.matchMethod === "sender"
                              ? "Pagal siuntėją"
                              : "Ranka"}
                      </td>
                      <td className="py-3 pr-2 align-top text-xs text-slate-600">
                        <span className="line-clamp-3 whitespace-pre-wrap">{o.bodyText}</span>
                      </td>
                      <td className="py-3 align-top">
                        <button
                          type="button"
                          onClick={() => openConfirm(o.carrierEmail)}
                          className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                        >
                          Tvirtinti užsakymą
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {offers.length > 0 ? (
            <p className="mt-2 text-xs text-slate-500">
              *Mažesnis balas (€/d.) = geresnis kainos ir termino santykis. Žymima tik jei nurodyta
              kaina ir terminas.
            </p>
          ) : null}
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-200 pt-6">
        <Link
          href="/orders"
          className="text-sm text-slate-600 hover:text-slate-900 hover:underline"
        >
          ← Visi užsakymai
        </Link>
        <button
          type="button"
          onClick={deleteOrder}
          disabled={deleting}
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-800 hover:bg-red-100 disabled:opacity-50"
        >
          {deleting ? "Trinama…" : "Ištrinti užsakymą"}
        </button>
      </div>
    </div>
  );
}
