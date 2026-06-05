import { prisma } from "@/lib/prisma";

/** Vidinis užsakymo nr. formatu TU#20260039 (leidžiamas tarpas po TU). */
const TU_RE = /TU\s*#\s*(\d{8})/i;

export type MatchMethod = "thread" | "tu" | "manual";

export type MatchInput = {
  subject: string;
  bodyText: string;
  senderEmail: string;
  conversationId?: string | null;
};

export function extractInternalIdFromText(text: string): string | null {
  const m = text.match(TU_RE);
  return m ? `TU#${m[1]}` : null;
}

/**
 * Susieja vežėjo atsakymą su užsakymu.
 * 1) TU# temoje / tekste (patikimiausia)
 * 2) El. pašto gija (tik išsiųstiems vežėjams — threadId arba conversationId)
 */
export async function matchOrderForCarrierReply(input: MatchInput): Promise<{
  orderId: string | null;
  internalId: string | null;
  matchMethod: MatchMethod | null;
}> {
  const haystack = `${input.subject}\n${input.bodyText}`;

  const byTu = extractInternalIdFromText(haystack);
  if (byTu) {
    const order = await prisma.order.findUnique({
      where: { internalId: byTu },
      select: { id: true, internalId: true },
    });
    if (order) {
      return { orderId: order.id, internalId: order.internalId, matchMethod: "tu" };
    }
    // Temoje yra TU#, bet užsakymas nerastas — nebandome thread fallback (sumažina klaidingą pririšimą).
    return { orderId: null, internalId: byTu, matchMethod: null };
  }

  const conversationId = input.conversationId?.trim();
  if (conversationId) {
    const byCarrierThread = await prisma.order.findFirst({
      where: {
        status: "sent_to_carriers",
        threadId: conversationId,
      },
      select: { id: true, internalId: true },
      orderBy: { sentAt: "desc" },
    });
    if (byCarrierThread) {
      return {
        orderId: byCarrierThread.id,
        internalId: byCarrierThread.internalId,
        matchMethod: "thread",
      };
    }

    // Senesni įrašai: conversationId naudotas tik jei užsakymas jau išsiųstas vežėjams
    const bySentConv = await prisma.order.findFirst({
      where: {
        status: "sent_to_carriers",
        conversationId,
      },
      select: { id: true, internalId: true },
      orderBy: { sentAt: "desc" },
    });
    if (bySentConv) {
      return {
        orderId: bySentConv.id,
        internalId: bySentConv.internalId,
        matchMethod: "thread",
      };
    }
  }

  return { orderId: null, internalId: null, matchMethod: null };
}
