import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string; offerId: string }> },
) {
  const { id, offerId } = await ctx.params;
  if (!id || !offerId || id.length > 100 || offerId.length > 100) {
    return NextResponse.json({ error: "Neteisingi identifikatoriai" }, { status: 400 });
  }
  const offer = await prisma.carrierOffer.findUnique({
    where: { id: offerId },
    select: { id: true, orderId: true },
  });
  if (!offer || offer.orderId !== id) {
    return NextResponse.json({ error: "Pasiūlymas nerastas" }, { status: 404 });
  }

  await prisma.carrierOffer.delete({ where: { id: offerId } });
  return NextResponse.json({ ok: true, id: offerId });
}
