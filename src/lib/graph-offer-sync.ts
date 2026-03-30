import { allKnownCarrierEmails } from "@/lib/carriers";
import { getGraphClient, graphMailboxUser } from "@/lib/graph-client";
import { matchOrderForCarrierReply } from "@/lib/order-matcher";
import { parseCarrierReplyBody } from "@/lib/parse-carrier-reply";
import { prisma } from "@/lib/prisma";

export type SyncOffersResult = {
  created: number;
  skipped: number;
  details: string[];
};

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Importuoja vežėjų atsakymus iš gautų laiškų (Graph).
 * Siuntėjas turi būti žinomas vežėjas; temoje / tekste — TU#xxxxxxxx.
 */
export async function syncCarrierOffersFromGraph(): Promise<SyncOffersResult> {
  const mailbox = graphMailboxUser();
  const client = await getGraphClient();
  const carriers = allKnownCarrierEmails();

  const details: string[] = [];
  let created = 0;
  let skipped = 0;

  const list = await client
    .api(`/users/${encodeURIComponent(mailbox)}/mailFolders/inbox/messages`)
    .orderby("receivedDateTime desc")
    .top(50)
    .select("id,subject,bodyPreview,from,conversationId")
    .get();

  const items = (list.value ?? []) as Array<{
    id: string;
    subject?: string;
    bodyPreview?: string;
    conversationId?: string;
    from?: { emailAddress?: { address?: string } };
  }>;

  for (const item of items) {
    const fromAddr = item.from?.emailAddress?.address?.toLowerCase() ?? "";
    if (!fromAddr || !carriers.has(fromAddr)) {
      skipped += 1;
      continue;
    }

    const subject = item.subject ?? "";
    const preview = item.bodyPreview ?? "";
    const matched = await matchOrderForCarrierReply({
      subject,
      bodyPreview: preview,
      senderEmail: fromAddr,
      conversationId: item.conversationId ?? null,
    });
    if (!matched.orderId) {
      skipped += 1;
      details.push(`${item.id}: nepavyko susieti su užsakymu`);
      continue;
    }

    const existing = await prisma.carrierOffer.findUnique({
      where: { graphMessageId: item.id },
    });
    if (existing) {
      skipped += 1;
      continue;
    }

    const full = await client
      .api(`/users/${encodeURIComponent(mailbox)}/messages/${item.id}`)
      .select("id,subject,body,bodyPreview")
      .get();

    const bodyObj = full.body as { contentType?: string; content?: string } | undefined;
    let bodyText = "";
    if (bodyObj?.content) {
      if (bodyObj.contentType?.toLowerCase() === "html") {
        bodyText = stripHtml(bodyObj.content);
      } else {
        bodyText = bodyObj.content.trim();
      }
    }
    if (!bodyText) bodyText = preview;

    const parsed = await parseCarrierReplyBody(bodyText);

    await prisma.carrierOffer.create({
      data: {
        orderId: matched.orderId,
        carrierEmail: fromAddr,
        bodyText: bodyText.slice(0, 50000),
        priceEur: parsed.priceEur,
        termText: parsed.termText,
        termDays: parsed.termDays,
        vatNote: parsed.vatNote,
        source: "email",
        graphMessageId: item.id,
        replySubject: subject.slice(0, 500),
        matchMethod: matched.matchMethod ?? "sender",
      },
    });

    created += 1;
    details.push(
      `Pasiūlymas iš ${fromAddr} → ${matched.internalId ?? "nežinomas"} (${matched.matchMethod ?? "n/a"})`,
    );
  }

  return { created, skipped, details };
}
