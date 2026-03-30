import { OrdersTable } from "@/components/OrdersTable";
import { prisma } from "@/lib/prisma";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const orders = await prisma.order.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { offers: true } } },
  });

  const rows = orders.map((o) => ({
    id: o.id,
    internalId: o.internalId,
    manufacturer: o.manufacturer,
    country: o.country,
    status: o.status,
    reviewRequired: o.reviewRequired,
    sentAt: o.sentAt?.toISOString() ?? null,
    createdAt: o.createdAt.toISOString(),
    offersCount: o._count.offers,
  }));

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-xl">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Užsakymai
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-700">
            Importuojant iš pašto DI naudoja <strong>laiško tekstą</strong> ir{" "}
            <strong>iš PDF/Excel ištrauktą tekstą</strong> (ne vien DB be parsinimo). Šalis ir
            adresas turi atsirasti iš turinio / priedų, ne iš siuntėjo pašto.
          </p>
        </div>
        <Link
          href="/orders/new"
          className="rounded-lg border-2 border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 shadow-sm hover:border-slate-400 hover:bg-slate-50"
        >
          Naujas užsakymas (ranka)
        </Link>
      </div>

      {orders.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white px-6 py-14 text-center shadow-sm">
          <p className="text-base font-medium text-slate-800">
            Užsakymų dar nėra
          </p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-600">
            Kai gausite laišką su užsakymu arba sukursite įrašą ranka, jis čia pasirodys.
          </p>
        </div>
      ) : (
        <OrdersTable orders={rows} />
      )}
    </div>
  );
}
