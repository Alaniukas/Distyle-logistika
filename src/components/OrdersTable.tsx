"use client";

import { statusLabel } from "@/lib/order-status";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

export type OrderListRow = {
  id: string;
  internalId: string;
  manufacturer: string;
  country: string;
  status: string;
  reviewRequired: boolean;
  sentAt: string | null;
  createdAt: string;
  offersCount: number;
};

type Props = {
  orders: OrderListRow[];
};

export function OrdersTable({ orders }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  const allIds = useMemo(() => orders.map((o) => o.id), [orders]);
  const allSelected = orders.length > 0 && selected.size === orders.length;
  const someSelected = selected.size > 0;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(allIds));
    }
  }

  async function bulkDelete() {
    if (selected.size === 0) return;
    if (
      !window.confirm(
        `Ištrinti ${selected.size} užsakymą(-ų)? Šio veiksmo negalima atšaukti.`,
      )
    ) {
      return;
    }
    setDeleting(true);
    const res = await fetch("/api/orders/bulk-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [...selected] }),
    });
    setDeleting(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(typeof j.error === "string" ? j.error : "Nepavyko ištrinti");
      return;
    }
    setSelected(new Set());
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {someSelected ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
          <span className="text-sm text-slate-700">
            Pažymėta: <span className="font-semibold">{selected.size}</span>
          </span>
          <button
            type="button"
            onClick={bulkDelete}
            disabled={deleting}
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-800 hover:bg-red-100 disabled:opacity-50"
          >
            {deleting ? "Trinama…" : "Ištrinti pažymėtus"}
          </button>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-md">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-600">
            <tr>
              <th className="w-10 px-2 py-3">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="h-4 w-4 rounded border-slate-300"
                  title="Žymėti visus"
                  aria-label="Žymėti visus"
                />
              </th>
              <th className="px-4 py-3">ID</th>
              <th className="px-4 py-3">Gamintojas</th>
              <th className="px-4 py-3">Šalis</th>
              <th className="px-4 py-3">Būsena</th>
              <th className="px-4 py-3">Vežėjams</th>
              <th className="px-4 py-3">Peržiūra</th>
              <th className="px-4 py-3">Pasiūlymai</th>
              <th className="px-4 py-3">Data</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {orders.map((o) => (
              <tr key={o.id} className="hover:bg-slate-50/90">
                <td className="px-2 py-3 align-middle">
                  <input
                    type="checkbox"
                    checked={selected.has(o.id)}
                    onChange={() => toggle(o.id)}
                    className="h-4 w-4 rounded border-slate-300"
                    aria-label={`Žymėti ${o.internalId}`}
                  />
                </td>
                <td className="px-4 py-3 font-mono text-xs">
                  <Link
                    href={`/orders/${o.id}`}
                    className="font-medium text-blue-700 underline-offset-2 hover:underline"
                  >
                    {o.internalId}
                  </Link>
                </td>
                <td className="px-4 py-3 text-slate-800">{o.manufacturer}</td>
                <td className="px-4 py-3 text-slate-800">{o.country}</td>
                <td className="px-4 py-3 text-slate-800">{statusLabel(o.status)}</td>
                <td className="px-4 py-3 text-slate-800">
                  {o.sentAt ? (
                    <span
                      className="rounded bg-emerald-50 px-2 py-0.5 text-xs text-emerald-900"
                      title={new Date(o.sentAt).toLocaleString("lt-LT")}
                    >
                      Išsiųsta
                    </span>
                  ) : (
                    <span className="text-xs text-slate-500">Neišsiųsta</span>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-800">
                  {o.reviewRequired ? (
                    <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                      Reikia peržiūros
                    </span>
                  ) : (
                    <span className="text-xs text-slate-500">OK</span>
                  )}
                </td>
                <td className="px-4 py-3 tabular-nums text-slate-800">{o.offersCount}</td>
                <td className="px-4 py-3 text-slate-600">
                  {new Date(o.createdAt).toLocaleString("lt-LT")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
