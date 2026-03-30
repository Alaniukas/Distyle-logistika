"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function NewOrderPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const fd = new FormData(e.currentTarget);
    const payload = {
      manufacturer: fd.get("manufacturer"),
      country: fd.get("country"),
      pickupAddress: fd.get("pickupAddress"),
      weightKg: fd.get("weightKg"),
      volumeM3: fd.get("volumeM3"),
      shipperComment: fd.get("shipperComment"),
      pickupReference: fd.get("pickupReference"),
    };
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setLoading(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(typeof j.error === "string" ? j.error : "Klaida kuriant užsakymą");
      return;
    }
    const order = await res.json();
    router.push(`/orders/${order.id}`);
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <Link
        href="/orders"
        className="text-sm text-slate-600 hover:text-slate-900 hover:underline"
      >
        ← Užsakymai
      </Link>
      <h1 className="mt-4 text-2xl font-semibold text-slate-900">
        Testinis užsakymas
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-slate-700">
        Tik <strong className="text-slate-900">vystymui</strong>: gamyboje užsakymą
        sukurs sistema iš el. pašto. Čia įvedi duomenis ranka ir gauni TU# numerį.
      </p>
      <p className="mt-2 text-sm text-slate-600">
        Šalyje įrašyk <strong>test</strong> — laišką gaus tik testinis gavėjas (ne
        visi vežėjai).
      </p>

      <form
        onSubmit={onSubmit}
        className="mt-8 flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        {error ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        ) : null}
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-slate-800">Gamintojas</span>
          <input
            name="manufacturer"
            required
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            placeholder="pvz. BOLIA"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-slate-800">Šalis (maršrutui)</span>
          <input
            name="country"
            required
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            placeholder="pvz. Italija, Lenkija, test"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-slate-800">Pakrovimo adresas</span>
          <textarea
            name="pickupAddress"
            required
            rows={3}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
          />
        </label>
        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-slate-800">Svoris (kg)</span>
            <input
              name="weightKg"
              type="number"
              step="any"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-slate-800">Tūris (m³)</span>
            <input
              name="volumeM3"
              type="number"
              step="any"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            />
          </label>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-slate-800">
            Paėmimo nuorodos (iš gamintojo — užsakymo nr., pickup ref ir pan., ne TU#)
          </span>
          <input
            name="pickupReference"
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            placeholder="pvz. 701806851, 701791458"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-slate-800">Komentaras</span>
          <textarea
            name="shipperComment"
            rows={2}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
          />
        </label>
        <button
          type="submit"
          disabled={loading}
          className="mt-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-60"
        >
          {loading ? "Kuriama…" : "Sukurti testinį užsakymą"}
        </button>
      </form>
    </div>
  );
}
