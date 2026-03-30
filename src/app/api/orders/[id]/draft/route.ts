import {
  buildDefaultCarrierEmailHtml,
  carrierEmailSubject,
  type OrderForTemplate,
} from "@/lib/carrier-email-template";
import { bccForRoute, effectiveCountryRoute, toEmailForRoute } from "@/lib/carriers";
import { polishAdditionalNotesForCarriers } from "@/lib/polish-carrier-notes";
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

/**
 * GET — numatytasis laiško HTML ir tema (redagavimui prieš siuntimą).
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) {
    return NextResponse.json({ error: "Nerastas" }, { status: 404 });
  }
  const t = toTemplate(order);
  const route = effectiveCountryRoute(order.country, order.emailSubject);
  const additionalNotes = await polishAdditionalNotesForCarriers(t);
  const html = buildDefaultCarrierEmailHtml(t, { additionalNotes });
  const subject = carrierEmailSubject(t);
  return NextResponse.json({
    html,
    subject,
    route,
    to: toEmailForRoute(route),
    bcc: bccForRoute(route),
  });
}
