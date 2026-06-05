import {
  carrierEmailSubject,
  type OrderForTemplate,
} from "@/lib/carrier-email-template";
import { normalizeTrustedText } from "@/lib/input-security";
import { prisma } from "@/lib/prisma";
import { canSendOrderToCarriers } from "@/lib/order-quantity-validation";
import { sendCarrierEmailHtml } from "@/lib/send-carrier-email";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function toTemplate(order: {
  internalId: string;
  manufacturer: string;
  country: string;
  pickupAddress: string;
  palletDimensions: string;
  weightKg: number | null;
  volumeM3: number | null;
  shipperComment: string;
  pickupReference: string;
  packingListBreakdownJson: string | null;
}): OrderForTemplate {
  return {
    internalId: order.internalId,
    manufacturer: order.manufacturer,
    country: order.country,
    pickupAddress: order.pickupAddress,
    palletDimensions: order.palletDimensions,
    weightKg: order.weightKg,
    volumeM3: order.volumeM3,
    shipperComment: order.shipperComment,
    pickupReference: order.pickupReference,
    packingListBreakdownJson: order.packingListBreakdownJson,
  };
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) {
    return NextResponse.json({ error: "Nerastas" }, { status: 404 });
  }
  if (order.status !== "pending_review") {
    return NextResponse.json(
      { error: "Siųsti galima tik užsakymus, kurie dar neišsiųsti vežėjams" },
      { status: 400 },
    );
  }

  const sendCheck = canSendOrderToCarriers(order);
  if (!sendCheck.allowed) {
    return NextResponse.json({ error: sendCheck.message }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const html = normalizeTrustedText(body.html, 200_000);
  const subjectIn = normalizeTrustedText(body.subject, 500);
  if (!html.trim()) {
    return NextResponse.json(
      { error: "Nurodykite laiško HTML (html)" },
      { status: 400 },
    );
  }

  const t = toTemplate(order);
  const subject = subjectIn || carrierEmailSubject(t);

  try {
    const result = await sendCarrierEmailHtml(t, html, subject, order.emailSubject);

    const updated = await prisma.order.update({
      where: { id },
      data: {
        status: "sent_to_carriers",
        emailHtml: result.html,
        countryRoute: result.route,
        sentAt: new Date(),
        ...(result.carrierThreadId ? { threadId: result.carrierThreadId } : {}),
      },
    });

    return NextResponse.json({
      order: updated,
      meta: { to: result.to, bccCount: result.bcc.length, subject: result.subject },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Nežinoma klaida";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
