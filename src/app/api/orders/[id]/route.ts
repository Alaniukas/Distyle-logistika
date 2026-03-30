import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const r = await prisma.order.deleteMany({ where: { id } });
  if (r.count === 0) {
    return NextResponse.json({ error: "Nerastas" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      offers: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!order) {
    return NextResponse.json({ error: "Nerastas" }, { status: 404 });
  }
  return NextResponse.json(order);
}
