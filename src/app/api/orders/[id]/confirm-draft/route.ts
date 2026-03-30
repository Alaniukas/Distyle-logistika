import {
  buildConfirmationEmailHtml,
  confirmationEmailSubject,
  type OrderForTemplate,
} from "@/lib/carrier-email-template";
import { prisma } from "@/lib/prisma";
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

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const carrierEmail =
    new URL(req.url).searchParams.get("carrierEmail")?.trim() ?? "";
  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) {
    return NextResponse.json({ error: "Nerastas" }, { status: 404 });
  }
  const t = toTemplate(order);
  const html = buildConfirmationEmailHtml(t, carrierEmail || "vezejai@example.lt");
  const subject = confirmationEmailSubject(t);
  return NextResponse.json({ html, subject });
}
