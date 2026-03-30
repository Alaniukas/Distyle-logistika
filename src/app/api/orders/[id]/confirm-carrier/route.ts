import { confirmationEmailSubject, type OrderForTemplate } from "@/lib/carrier-email-template";
import { prisma } from "@/lib/prisma";
import { sendSingleCarrierEmailHtml } from "@/lib/send-carrier-email";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function toTemplate(order: {
  internalId: string;
  manufacturer: string;
  country: string;
  pickupAddress: string;
  weightKg: number | null;
  volumeM3: number | null;
  shipperComment: string;
  pickupReference: string;
}): OrderForTemplate {
  return {
    internalId: order.internalId,
    manufacturer: order.manufacturer,
    country: order.country,
    pickupAddress: order.pickupAddress,
    weightKg: order.weightKg,
    volumeM3: order.volumeM3,
    shipperComment: order.shipperComment,
    pickupReference: order.pickupReference,
  };
}

/**
 * POST — patvirtinimo laiškas vienam vežėjui (redaguotas HTML iš kliento).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) {
    return NextResponse.json({ error: "Nerastas" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const carrierEmail = String((body as Record<string, unknown>)?.carrierEmail ?? "").trim();
  const html = String((body as Record<string, unknown>)?.html ?? "").trim();
  const subject =
    String((body as Record<string, unknown>)?.subject ?? "").trim() ||
    confirmationEmailSubject(toTemplate(order));

  if (!carrierEmail || !html) {
    return NextResponse.json(
      { error: "Privalomi laukai: carrierEmail, html" },
      { status: 400 },
    );
  }

  try {
    await sendSingleCarrierEmailHtml(carrierEmail, html, subject);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Siuntimo klaida";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
