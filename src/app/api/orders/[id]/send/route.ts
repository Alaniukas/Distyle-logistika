import {
  carrierEmailSubject,
  type OrderForTemplate,
} from "@/lib/carrier-email-template";
import { prisma } from "@/lib/prisma";
import { sendCarrierEmailHtml } from "@/lib/send-carrier-email";
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

  const body = await req.json().catch(() => ({}));
  const html = typeof body.html === "string" ? body.html : "";
  const subjectIn = typeof body.subject === "string" ? body.subject.trim() : "";
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
