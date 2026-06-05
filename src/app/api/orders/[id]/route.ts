import { normalizeTrustedText } from "@/lib/input-security";
import { computePackingListValidated } from "@/lib/order-quantity-validation";
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

  const existing = await prisma.order.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Nerastas" }, { status: 404 });
  }

  const data: {
    pickupAddress?: string;
    palletDimensions?: string;
    weightKg?: number | null;
    volumeM3?: number | null;
    reviewRequired?: boolean;
    packingListValidated?: boolean;
  } = {};

  if (body.pickupAddress !== undefined) {
    const addr = normalizeTrustedText(body.pickupAddress, 500);
    if (!addr) {
      return NextResponse.json({ error: "Pakrovimo adresas negali būti tuščias" }, { status: 400 });
    }
    data.pickupAddress = addr;
  }
  if (body.palletDimensions !== undefined) {
    data.palletDimensions = normalizeTrustedText(body.palletDimensions, 2000);
  }
  if (body.weightKg !== undefined) {
    const w = typeof body.weightKg === "number" ? body.weightKg : Number(body.weightKg);
    data.weightKg = Number.isFinite(w) ? w : null;
  }
  if (body.volumeM3 !== undefined) {
    const v = typeof body.volumeM3 === "number" ? body.volumeM3 : Number(body.volumeM3);
    data.volumeM3 = Number.isFinite(v) ? v : null;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json(
      { error: "Nurodykite pickupAddress, palletDimensions, weightKg arba volumeM3" },
      { status: 400 },
    );
  }

  const merged = {
    ...existing,
    ...data,
  };
  if (
    data.weightKg !== undefined ||
    data.volumeM3 !== undefined ||
    existing.packingListBreakdownJson
  ) {
    data.packingListValidated = computePackingListValidated(merged);
    if (!data.packingListValidated && existing.packingListBreakdownJson) {
      data.reviewRequired = true;
    } else if (data.packingListValidated && data.pickupAddress) {
      data.reviewRequired = false;
    }
  } else if (data.pickupAddress) {
    data.reviewRequired = false;
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
