import { generateCarrierEmailHtml } from "@/lib/generate-carrier-email";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * POST — alternatyva: laiškas sugeneruotas per Gemini (jei nustatytas raktas).
 */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) {
    return NextResponse.json({ error: "Nerastas" }, { status: 404 });
  }
  try {
    const html = await generateCarrierEmailHtml({
      internalId: order.internalId,
      manufacturer: order.manufacturer,
      country: order.country,
      pickupAddress: order.pickupAddress,
      weightKg: order.weightKg,
      volumeM3: order.volumeM3,
      shipperComment: order.shipperComment,
      pickupReference: order.pickupReference,
    });
    return NextResponse.json({ html });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Klaida";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
