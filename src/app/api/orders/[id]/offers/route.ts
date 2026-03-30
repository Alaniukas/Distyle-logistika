import { prisma } from "@/lib/prisma";
import { parseCarrierReplyBody } from "@/lib/parse-carrier-reply";
import { NextResponse } from "next/server";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) {
    return NextResponse.json({ error: "Nerastas" }, { status: 404 });
  }
  const offers = await prisma.carrierOffer.findMany({
    where: { orderId: id },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(offers);
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) {
    return NextResponse.json({ error: "Nerastas" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const carrierEmail = String((body as Record<string, unknown>)?.carrierEmail ?? "").trim();
  const bodyText = String((body as Record<string, unknown>)?.bodyText ?? "").trim();
  if (!carrierEmail || !bodyText) {
    return NextResponse.json(
      { error: "Privalomi laukai: carrierEmail, bodyText" },
      { status: 400 },
    );
  }

  const offer = await prisma.carrierOffer.create({
    data: {
      orderId: id,
      carrierEmail,
      bodyText,
      ...(await parseCarrierReplyBody(bodyText)),
      source: "manual",
      matchMethod: "manual",
    },
  });
  return NextResponse.json(offer);
}
