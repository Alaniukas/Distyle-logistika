import { prisma } from "@/lib/prisma";
import { normalizeTrustedText } from "@/lib/input-security";
import { allocateNextInternalId } from "@/lib/tu-number";
import { NextResponse } from "next/server";

export async function GET() {
  const orders = await prisma.order.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { offers: true } } },
  });
  return NextResponse.json(orders);
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Neteisingas JSON" }, { status: 400 });
  }

  const manufacturer = normalizeTrustedText((body as Record<string, unknown>).manufacturer, 200);
  const country = normalizeTrustedText((body as Record<string, unknown>).country, 120);
  const pickupAddress = normalizeTrustedText((body as Record<string, unknown>).pickupAddress, 500);
  if (!manufacturer || !country || !pickupAddress) {
    return NextResponse.json(
      { error: "Privalomi laukai: gamintojas, šalis, pakrovimo adresas" },
      { status: 400 },
    );
  }

  const weightRaw = (body as Record<string, unknown>).weightKg;
  const volumeRaw = (body as Record<string, unknown>).volumeM3;
  const weightKg =
    weightRaw === "" || weightRaw === undefined || weightRaw === null
      ? null
      : Number(weightRaw);
  const volumeM3 =
    volumeRaw === "" || volumeRaw === undefined || volumeRaw === null
      ? null
      : Number(volumeRaw);

  const shipperComment = normalizeTrustedText((body as Record<string, unknown>).shipperComment, 50_000);
  const pickupReference = normalizeTrustedText((body as Record<string, unknown>).pickupReference, 2_000);

  const internalId = await allocateNextInternalId();
  const order = await prisma.order.create({
    data: {
      internalId,
      manufacturer,
      country,
      pickupAddress,
      weightKg: weightKg !== null && !Number.isNaN(weightKg) ? weightKg : null,
      volumeM3: volumeM3 !== null && !Number.isNaN(volumeM3) ? volumeM3 : null,
      shipperComment,
      pickupReference,
      status: "pending_review",
    },
  });

  return NextResponse.json(order);
}
