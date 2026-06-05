import {
  parsePackingListJson,
  type PackingListFormat,
} from "@/lib/packing-list-parser";

const FORMAT_LABEL: Record<PackingListFormat, string> = {
  saba: "Saba",
  furninova: "Furninova",
  bolia: "Bolia",
  generic: "Packing list",
};

type Props = {
  packingListBreakdownJson: string | null | undefined;
  packingListValidated?: boolean;
  weightKg?: number | null;
  volumeM3?: number | null;
};

export function PackingListBreakdown({
  packingListBreakdownJson,
  packingListValidated,
  weightKg,
  volumeM3,
}: Props) {
  const breakdown = parsePackingListJson(packingListBreakdownJson ?? null);
  if (!breakdown) return null;

  const { lines, totals, warnings, format } = breakdown;
  const formatLabel = FORMAT_LABEL[format] ?? "Packing list";

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          {formatLabel} — packing list
        </h2>
        <span
          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
            packingListValidated
              ? "bg-emerald-100 text-emerald-900"
              : "bg-amber-100 text-amber-900"
          }`}
        >
          {packingListValidated ? "Kiekiai patvirtinti" : "Reikia patikrinti kiekius"}
        </span>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[480px] text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
            <tr>
              <th className="py-2 pr-3">Užsakymas</th>
              <th className="py-2 pr-3">Segmentas</th>
              <th className="py-2 pr-3">Dėžės</th>
              <th className="py-2 pr-3">m³</th>
              <th className="py-2">Bruto kg</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {lines.map((l, i) => (
              <tr key={`${l.orderRef}-${l.label ?? ""}-${i}`}>
                <td className="py-2 pr-3 font-medium text-slate-900">{l.orderRef}</td>
                <td className="py-2 pr-3 text-slate-700">{l.label ?? "—"}</td>
                <td className="py-2 pr-3">{l.boxes}</td>
                <td className="py-2 pr-3">{Math.round(l.volumeM3 * 1000) / 1000}</td>
                <td className="py-2">{Math.round(l.grossKg * 10) / 10}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-slate-200 font-semibold text-slate-900">
            <tr>
              <td colSpan={2} className="py-2 pr-3">
                Viso (packing list)
              </td>
              <td className="py-2 pr-3">{totals.boxes}</td>
              <td className="py-2 pr-3">{Math.round(totals.volumeM3 * 1000) / 1000}</td>
              <td className="py-2">{Math.round(totals.grossKg * 10) / 10}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="mt-3 text-sm text-slate-600">
        Užsakyme: {weightKg != null ? `${weightKg} kg` : "—"},{" "}
        {volumeM3 != null ? `${volumeM3} m³` : "—"}
      </p>
      {warnings.length > 0 ? (
        <ul className="mt-2 list-inside list-disc text-sm text-amber-800">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
