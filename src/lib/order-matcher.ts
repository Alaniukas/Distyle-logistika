import { prisma } from "@/lib/prisma";

const TU_RE = /TU#\d{8}/i;

export type MatchMethod = "thread" | "tu" | "sender" | "manual";

export type MatchInput = {
  subject: string;
  bodyPreview: string;
  senderEmail: string;
  conversationId?: string | null;
};

export function extractInternalIdFromText(text: string): string | null {
  const m = text.match(TU_RE);
  return m ? m[0].toUpperCase() : null;
}

export async function matchOrderForCarrierReply(input: MatchInput): Promise<{
  orderId: string | null;
  internalId: string | null;
  matchMethod: MatchMethod | null;
}> {
  const conversationId = input.conversationId?.trim();
  if (conversationId) {
    const byThread = await prisma.order.findFirst({
      where: { conversationId },
      select: { id: true, internalId: true },
      orderBy: { createdAt: "desc" },
    });
    if (byThread) {
      return { orderId: byThread.id, internalId: byThread.internalId, matchMethod: "thread" };
    }
  }

  const byTu = extractInternalIdFromText(`${input.subject}\n${input.bodyPreview}`);
  if (byTu) {
    const order = await prisma.order.findUnique({
      where: { internalId: byTu },
      select: { id: true, internalId: true },
    });
    if (order) {
      return { orderId: order.id, internalId: order.internalId, matchMethod: "tu" };
    }
  }

  const sender = input.senderEmail.trim().toLowerCase();
  const recent = await prisma.carrierOffer.findFirst({
    where: { carrierEmail: sender },
    orderBy: { createdAt: "desc" },
    select: { orderId: true, order: { select: { internalId: true } } },
  });
  if (recent?.orderId) {
    return {
      orderId: recent.orderId,
      internalId: recent.order.internalId,
      matchMethod: "sender",
    };
  }

  return { orderId: null, internalId: null, matchMethod: null };
}

