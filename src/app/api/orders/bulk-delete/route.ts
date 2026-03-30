import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** POST /api/orders/bulk-delete — body: { "ids": string[] } */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { ids?: unknown };
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((x): x is string => typeof x === "string" && x.length > 0)
    : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "Nurodykite ids masyvą" }, { status: 400 });
  }
  const r = await prisma.order.deleteMany({ where: { id: { in: ids } } });
  return NextResponse.json({ ok: true, deleted: r.count });
}
