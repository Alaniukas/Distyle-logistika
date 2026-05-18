import { normalizeTrustedText } from "@/lib/input-security";
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

/** PATCH — rankinis pakrovimo adreso / palečių matmenų atnaujinimas prieš siuntimą vežėjams. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: "Neteisingas JSON" }, { status: 400 });
  }

  const data: { pickupAddress?: string; palletDimensions?: string; reviewRequired?: boolean } = {};
  if (body.pickupAddress !== undefined) {
    const addr = normalizeTrustedText(body.pickupAddress, 500);
    if (!addr) {
      return NextResponse.json({ error: "Pakrovimo adresas negali būti tuščias" }, { status: 400 });
    }
    data.pickupAddress = addr;
    data.reviewRequired = false;
  }
  if (body.palletDimensions !== undefined) {
    data.palletDimensions = normalizeTrustedText(body.palletDimensions, 2000);
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nurodykite pickupAddress arba palletDimensions" }, { status: 400 });
  }

  const order = await prisma.order.update({
    where: { id },
    data,
  });
  return NextResponse.json(order);
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
