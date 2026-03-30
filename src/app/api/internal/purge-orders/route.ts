import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * POST /api/internal/purge-orders
 * Authorization: Bearer SYNC_SECRET
 * Body: { "scope": "pending_graph" } | { "scope": "all" }
 *
 * Masinis užsakymų trynimas (pvz. po netikusio sinchronų testo).
 */
export async function POST(req: Request) {
  const secret = process.env.SYNC_SECRET?.trim();
  const auth = req.headers.get("authorization")?.trim();
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Neautorizuota" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { scope?: string };
  const scope = body.scope;

  if (scope === "all") {
    const r = await prisma.order.deleteMany({});
    return NextResponse.json({ ok: true, deleted: r.count, scope: "all" });
  }

  if (scope === "pending_graph") {
    const r = await prisma.order.deleteMany({
      where: { status: "pending_review", source: "graph" },
    });
    return NextResponse.json({ ok: true, deleted: r.count, scope: "pending_graph" });
  }

  return NextResponse.json(
    { error: 'Nurodykite body.scope: "pending_graph" arba "all"' },
    { status: 400 },
  );
}
