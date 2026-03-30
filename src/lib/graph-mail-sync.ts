import type { Client } from "@microsoft/microsoft-graph-client";
import { ResponseType } from "@microsoft/microsoft-graph-client";
import { countryLabelFromRoute, inferRouteFromSubject } from "@/lib/carriers";
import { getGraphClient, graphMailboxUser } from "@/lib/graph-client";
import type { SyncMailResult } from "@/lib/imap-sync";
import {
  extractAttachmentTexts,
  normalizeBodyText,
  parseOrderFromMailSources,
  type GraphAttachment,
} from "@/lib/mail-ingest-parser";
import {
  hasInReplyToFromGraphHeaders,
  isLikelyReplySubject,
  mailSubjectFilterFromEnv,
  subjectMatchesOptionalFilter,
} from "@/lib/inbound-mail-rules";
import { prisma } from "@/lib/prisma";
import { isAllowedSender } from "@/lib/sender-whitelist";
import { allocateNextInternalId } from "@/lib/tu-number";

function buildIngestKey(messageId: string | undefined, graphId: string): string {
  const raw = messageId?.trim();
  if (raw && raw.length > 0) return raw.slice(0, 900);
  return `graph-${graphId}`;
}

type GraphMessageListItem = {
  id: string;
  subject?: string;
  internetMessageId?: string;
  bodyPreview?: string;
};

type GraphMessageBody = {
  contentType?: string;
  content?: string;
};

type GraphFrom = {
  emailAddress?: { address?: string; name?: string };
};

function isFileAttachment(raw: Record<string, unknown>): boolean {
  const t = String(raw["@odata.type"] ?? "");
  if (t.includes("itemAttachment") || t.includes("referenceAttachment")) return false;
  if (t.includes("fileAttachment")) return true;
  const name = typeof raw.name === "string" ? raw.name : "";
  return /\.(pdf|xlsx?|xls|docx|csv)$/i.test(name);
}

/** Dideliems PDF Graph dažnai negrąžina contentBytes JSON — tik per /$value. */
async function downloadAttachmentBinary(
  client: Client,
  mailbox: string,
  messageId: string,
  attachmentId: string,
): Promise<Buffer | null> {
  try {
    const path = `/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}/$value`;
    const ab = (await client.api(path).responseType(ResponseType.ARRAYBUFFER).get()) as ArrayBuffer;
    return Buffer.from(ab);
  } catch {
    return null;
  }
}

/** Užpildo contentBytes: metadata GET, tada /$value jei reikia. */
async function enrichAttachmentsWithContentBytes(
  client: Client,
  mailbox: string,
  messageId: string,
  attachments: GraphAttachment[],
): Promise<GraphAttachment[]> {
  const out: GraphAttachment[] = [];
  for (const a of attachments) {
    let cur: GraphAttachment = { ...a };
    if (cur.contentBytes && String(cur.contentBytes).length > 0) {
      out.push(cur);
      continue;
    }
    try {
      const detail = (await client
        .api(
          `/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(a.id)}`,
        )
        .get()) as GraphAttachment & Record<string, unknown>;
      cur = { ...cur, ...detail };
    } catch {
      /* paliekam cur */
    }
    if (!cur.contentBytes || String(cur.contentBytes).length === 0) {
      const bin = await downloadAttachmentBinary(client, mailbox, messageId, a.id);
      if (bin && bin.length > 0) {
        cur = { ...cur, contentBytes: bin.toString("base64") };
      }
    }
    out.push(cur);
  }
  return out;
}

/**
 * Perskaito neperskaitytus laiškus per Microsoft Graph (ne IMAP).
 */
export async function syncInboxFromGraph(): Promise<SyncMailResult> {
  // Tuščia MAIL_SUBJECT_FILTER = papildomo temos filtro nėra (tik whitelist siuntėjai).
  const subjectFilter = mailSubjectFilterFromEnv();
  const markSeen = process.env.MAIL_MARK_SEEN === "true";
  const mailbox = graphMailboxUser();
  const client = await getGraphClient();

  const details: string[] = [];
  let created = 0;
  let skipped = 0;

  const list = await client
    .api(`/users/${encodeURIComponent(mailbox)}/mailFolders/inbox/messages`)
    .filter("isRead eq false")
    .orderby("receivedDateTime asc")
    .top(50)
    .select("id,subject,internetMessageId,bodyPreview")
    .get();

  const items: GraphMessageListItem[] = list.value ?? [];
  if (items.length === 0) {
    details.push("Nėra neperskaitytų laiškų.");
  }

  for (const item of items) {
    const subject = item.subject ?? "";
    if (!subjectMatchesOptionalFilter(subjectFilter, subject)) {
      skipped += 1;
      details.push(
        `${item.id}: tema „${subject}“ — neatitinka filtro „${subjectFilter || "(išjungta)"}“`,
      );
      continue;
    }

    let full = await client
      .api(`/users/${encodeURIComponent(mailbox)}/messages/${item.id}`)
      .select(
        "id,subject,internetMessageId,body,bodyPreview,from,conversationId,internetMessageHeaders",
      )
      .get()
      .catch(async () => {
        return client
          .api(`/users/${encodeURIComponent(mailbox)}/messages/${item.id}`)
          .select("id,subject,internetMessageId,body,bodyPreview,from,conversationId")
          .get();
      });

    const convId =
      typeof (full as { conversationId?: string }).conversationId === "string"
        ? (full as { conversationId: string }).conversationId
        : null;
    if (convId) {
      const threadOrder = await prisma.order.findFirst({
        where: { conversationId: convId },
        select: { id: true },
      });
      if (threadOrder) {
        skipped += 1;
        details.push(`${item.id}: atsakymas / ta pati gija — užsakymas jau sukurtas`);
        continue;
      }
    }

    const imh = (full as { internetMessageHeaders?: { name?: string; value?: string }[] })
      .internetMessageHeaders;
    if (
      isLikelyReplySubject(subject) ||
      hasInReplyToFromGraphHeaders(imh)
    ) {
      skipped += 1;
      details.push(`${item.id}: atsakymas (RE / In-Reply-To) — praleidžiama`);
      continue;
    }

    let attachments: GraphAttachment[] = [];
    let attachmentNames: string | null = null;
    try {
      const atts = await client
        .api(`/users/${encodeURIComponent(mailbox)}/messages/${item.id}/attachments`)
        .top(30)
        .get();
      const rawVals = (atts.value ?? []) as (GraphAttachment & Record<string, unknown>)[];
      const fileOnly = rawVals.filter((x) => isFileAttachment(x));
      attachments = await enrichAttachmentsWithContentBytes(client, mailbox, item.id, fileOnly);
      if (attachments.length > 0) {
        attachmentNames = JSON.stringify(attachments.map((a) => a.name ?? "failas"));
      }
    } catch {
      /* priedai neprivalomi */
    }

    const bodyObj = full.body as GraphMessageBody | undefined;
    let textBody = "";
    if (bodyObj?.content) {
      textBody = normalizeBodyText(bodyObj.contentType, bodyObj.content);
    }
    if (!textBody && full.bodyPreview) {
      textBody = full.bodyPreview.trim();
    }
    textBody = textBody || "(tuščias tekstas)";

    const ingestKey = buildIngestKey(full.internetMessageId, full.id);
    const existing = await prisma.ingestedMail.findUnique({
      where: { ingestKey },
    });
    if (existing) {
      skipped += 1;
      details.push(`${item.id}: jau apdorota (${ingestKey.slice(0, 40)}…)`);
      continue;
    }

    const fromField = full.from as GraphFrom | undefined;
    const fromAddr =
      fromField?.emailAddress?.address ||
      fromField?.emailAddress?.name ||
      "nežinomas@siuntėjas.lt";
    const fromName = fromField?.emailAddress?.name || fromAddr;
    const allowed = await isAllowedSender(fromAddr);
    if (!allowed) {
      skipped += 1;
      details.push(`${item.id}: siuntėjas ne whitelist'e (${fromAddr})`);
      continue;
    }

    const attachmentTextChunks = await extractAttachmentTexts(attachments);
    const attachmentTexts = attachmentTextChunks.join("\n\n");
    let extraReview = "";
    if (attachments.length > 0 && attachmentTextChunks.length === 0) {
      extraReview =
        " Priedai pridėti, bet teksto iš jų negauta (per didelis failas, tik vaizdas arba Graph negrąžino turinio).";
    }
    const parsed = await parseOrderFromMailSources({
      fromName,
      fromAddress: fromAddr,
      subject,
      bodyText: textBody,
      attachmentTexts: attachmentTextChunks,
    });
    const mergedNotes = [parsed.reviewNotes, extraReview].filter(Boolean).join(" ").trim() || null;

    const internalId = await allocateNextInternalId();

    const order = await prisma.order.create({
      data: {
        internalId,
        manufacturer: (parsed.manufacturer ?? fromName).slice(0, 200),
        country: (
          (parsed.country ?? "").trim() ||
          countryLabelFromRoute(inferRouteFromSubject(subject)) ||
          "Patikrinkite laiške"
        ).slice(0, 120),
        pickupAddress: (parsed.pickupAddress ?? "Adresas laiške").slice(0, 500),
        weightKg: parsed.weightKg,
        volumeM3: parsed.volumeM3,
        cargoValue: parsed.cargoValue,
        shipperComment: parsed.shipperComment,
        pickupReference: (parsed.pickupReference ?? "").slice(0, 2000),
        source: "graph",
        sourceFromEmail: fromAddr.slice(0, 320),
        emailSubject: subject.slice(0, 500),
        attachmentNamesJson: attachmentNames,
        reviewRequired: parsed.reviewRequired || Boolean(extraReview),
        reviewNotes: mergedNotes,
        parsedConfidence: parsed.parsedConfidence,
        conversationId:
          typeof (full as { conversationId?: string }).conversationId === "string"
            ? (full as { conversationId?: string }).conversationId
            : null,
        status: "pending_review",
      },
    });

    await prisma.ingestedMail.create({
      data: {
        ingestKey,
        orderId: order.id,
      },
    });

    if (markSeen) {
      await client
        .api(`/users/${encodeURIComponent(mailbox)}/messages/${item.id}`)
        .patch({ isRead: true });
    }

    created += 1;
    details.push(
      `Sukurta ${order.internalId} iš Graph ${item.id} (${subject})${parsed.reviewRequired ? " [reikia peržiūros]" : ""}`,
    );
  }

  return { created, skipped, details };
}
