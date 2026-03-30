import { OrderActions, type SerializedOrder } from "@/components/OrderActions";

export const dynamic = "force-dynamic";
import { prisma } from "@/lib/prisma";
import { statusLabel } from "@/lib/order-status";
import Link from "next/link";
import { notFound } from "next/navigation";

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const order = await prisma.order.findUnique({
    where: { id },
    include: { offers: { orderBy: { createdAt: "desc" } } },
  });
  if (!order) notFound();

  const serialized = JSON.parse(JSON.stringify(order)) as SerializedOrder;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <Link
        href="/orders"
        className="text-sm text-slate-600 hover:text-slate-900 hover:underline"
      >
        ← Užsakymai
      </Link>

      <header className="mt-4 border-b border-slate-200 pb-6">
        <p className="font-mono text-lg font-semibold text-slate-900">
          {order.internalId}
        </p>
        <p className="mt-1 text-sm text-slate-600">{statusLabel(order.status)}</p>
        {order.source === "graph" || order.source === "imap" ? (
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            Automatinis užpildymas: DI gauna <strong>laiško HTML/tekstą</strong> ir{" "}
            <strong>iš PDF/XLS ištrauktą tekstą</strong> (ne atsitiktinį DB lauką be parsinimo).
          </p>
        ) : null}
        {order.reviewRequired ? (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Reikia peržiūros. {order.reviewNotes ?? "Patikrinkite automatiškai ištrauktus laukus."}
          </p>
        ) : null}
        <dl className="mt-6 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">Gamintojas</dt>
            <dd className="font-medium text-slate-900">{order.manufacturer}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Šalis</dt>
            <dd className="font-medium text-slate-900">{order.country}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-slate-500">Pakrovimo adresas</dt>
            <dd className="text-slate-800">{order.pickupAddress}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-slate-500">
              Paėmimo / užsakymo nuorodos (iš gamintojo laiško ar priedų)
            </dt>
            <dd className="text-slate-800">{order.pickupReference?.trim() || "—"}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Svoris</dt>
            <dd>{order.weightKg != null ? `${order.weightKg} kg` : "—"}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Tūris</dt>
            <dd>{order.volumeM3 != null ? `${order.volumeM3} m³` : "—"}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Krovinio vertė</dt>
            <dd>{order.cargoValue != null ? `${order.cargoValue} €` : "—"}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Atpažinimo tikslumas</dt>
            <dd>
              {order.parsedConfidence != null
                ? `${Math.round(order.parsedConfidence * 100)}%`
                : "—"}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-slate-500">Komentaras</dt>
            <dd className="whitespace-pre-wrap text-slate-800">
              {order.shipperComment || "—"}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Šaltinis</dt>
            <dd className="text-slate-800">
              {order.source === "graph" || order.source === "imap"
                ? "Iš el. pašto"
                : "Įvesta ranka"}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-slate-500">Priedai (failų vardai iš pašto)</dt>
            <dd className="text-slate-800">
              {order.attachmentNamesJson
                ? (() => {
                    try {
                      const a = JSON.parse(order.attachmentNamesJson) as string[];
                      return Array.isArray(a) && a.length > 0
                        ? a.join(", ")
                        : "—";
                    } catch {
                      return order.attachmentNamesJson;
                    }
                  })()
                : "— (nėra arba laiškas be priedų)"}
            </dd>
          </div>
          {order.emailSubject ? (
            <div className="sm:col-span-2">
              <dt className="text-slate-500">Laiško tema</dt>
              <dd className="text-slate-800">{order.emailSubject}</dd>
            </div>
          ) : null}
        </dl>
      </header>

      <div className="mt-8">
        <OrderActions order={serialized} />
      </div>
    </div>
  );
}
