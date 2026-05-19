import type { Client } from "@microsoft/microsoft-graph-client";
import { ResponseType } from "@microsoft/microsoft-graph-client";
import { countryLabelFromRoute, inferRouteFromSubject } from "@/lib/carriers";
import { getGraphClient, graphMailboxUser } from "@/lib/graph-client";
import type { SyncMailResult } from "@/lib/imap-sync";
import {
  extractAttachmentTexts,
  normalizeBodyText,
  parseOrderFromMailSources,
  trimQuotedMailHistory,
  type GraphAttachment,
} from "@/lib/mail-ingest-parser";
import {
  hasInReplyToFromGraphHeaders,
  isLikelyReplySubject,
  mailSubjectFilterFromEnv,
  subjectMatchesOptionalFilter,
} from "@/lib/inbound-mail-rules";
import { classifyMailPickupIntent } from "@/lib/mail-pickup-intent";
import { extractFurninovaLoadingListRef } from "@/lib/manufacturer-mail-extract";
import { matchesManufacturerRuleByFromOnly } from "@/lib/manufacturer-inbound-rules";
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

function normalizeForCompare(v: string): string {
  return v
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSubjectForDedup(subject: string): string {
  return subject
    .toLowerCase()
    .replace(/^\s*(?:\[[^\]]+\]\s*)*/g, "")
    .replace(/^(?:(?:re|reg|aw|sv|vs|antw|fw|fwd|wg|ang|enc|odp|ref)\.?\s*:\s*)+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function pickupRefTokens(value: string | null | undefined): Set<string> {
  if (!value) return new Set<string>();
  const cleaned = value
    .toUpperCase()
    .replace(/[^A-Z0-9/,_;\- ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return new Set<string>();
  const parts = cleaned
    .split(/[;,]+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 5);
  return new Set(parts);
}

function refsOverlap(a: string | null | undefined, b: string | null | undefined): boolean {
  const ta = pickupRefTokens(a);
  const tb = pickupRefTokens(b);
  if (ta.size === 0 || tb.size === 0) return false;
  for (const token of ta) {
    if (tb.has(token)) return true;
  }
  return false;
}

function addressLooksSame(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeForCompare(a ?? "");
  const nb = normalizeForCompare(b ?? "");
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 12 && nb.length >= 12 && (na.includes(nb) || nb.includes(na))) return true;
  return false;
}

type ThreadOrderRow = {
  id: string;
  internalId: string;
  manufacturer: string;
  country: string;
  pickupAddress: string;
  pickupReference: string;
  shipperComment: string;
  emailSubject: string | null;
  attachmentNamesJson: string | null;
  reviewRequired: boolean;
  reviewNotes: string | null;
};

const threadOrderSelect = {
  id: true,
  internalId: true,
  manufacturer: true,
  country: true,
  pickupAddress: true,
  pickupReference: true,
  shipperComment: true,
  emailSubject: true,
  attachmentNamesJson: true,
  reviewRequired: true,
  reviewNotes: true,
} as const;

/** Furninova atsakymas su loading list nr. — susiejam su esamu užsakymu pagal nuorodą. */
async function findOrderByLoadingListRef(
  ref: string,
  fromAddr: string,
): Promise<ThreadOrderRow | null> {
  const refUp = ref.toUpperCase();
  const recent = await prisma.order.findMany({
    where: {
      createdAt: { gte: new Date(Date.now() - 1000 * 60 * 60 * 24 * 90) },
      OR: [
        { pickupReference: { contains: refUp, mode: "insensitive" } },
        { emailSubject: { contains: refUp, mode: "insensitive" } },
        { shipperComment: { contains: refUp, mode: "insensitive" } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 15,
    select: threadOrderSelect,
  });
  for (const cand of recent) {
    const tokens = pickupRefTokens(cand.pickupReference);
    if (tokens.has(refUp)) return cand;
    const blob = `${cand.emailSubject ?? ""} ${cand.pickupReference} ${cand.shipperComment}`.toUpperCase();
    if (blob.includes(refUp)) return cand;
  }
  return null;
}

async function findPotentialDuplicateOrder(input: {
  fromAddr: string;
  subject: string;
  pickupReference: string | null;
  pickupAddress: string | null;
}): Promise<{
  id: string;
  internalId: string;
  manufacturer: string;
  country: string;
  pickupAddress: string;
  pickupReference: string;
  shipperComment: string;
  attachmentNamesJson: string | null;
  reviewRequired: boolean;
  reviewNotes: string | null;
} | null> {
  const recent = await prisma.order.findMany({
    where: {
      source: "graph",
      sourceFromEmail: input.fromAddr,
      createdAt: { gte: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30) },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      internalId: true,
      manufacturer: true,
      country: true,
      pickupAddress: true,
      pickupReference: true,
      shipperComment: true,
      attachmentNamesJson: true,
      reviewRequired: true,
      reviewNotes: true,
      emailSubject: true,
    },
  });

  const subjectNorm = normalizeSubjectForDedup(input.subject);
  for (const cand of recent) {
    const candSubjectNorm = normalizeSubjectForDedup(cand.emailSubject ?? "");
    const subjectClose =
      Boolean(subjectNorm) &&
      Boolean(candSubjectNorm) &&
      (subjectNorm === candSubjectNorm ||
        subjectNorm.includes(candSubjectNorm) ||
        candSubjectNorm.includes(subjectNorm));

    const refsMatch = refsOverlap(input.pickupReference, cand.pickupReference);
    const addressMatch = addressLooksSame(input.pickupAddress, cand.pickupAddress);

    // Mažinam false positive: bent vienas stiprus signalas + temos artumas arba du signalai.
    if ((refsMatch && (subjectClose || addressMatch)) || (subjectClose && addressMatch)) {
      return cand;
    }
  }
  return null;
}

function extractReplyCommentBody(raw: string): string {
  return raw
    .replace(/^Tema:\s.*$/im, "")
    .replace(/^Nuo:\s.*$/im, "")
    .replace(/^\s*---\s*$/gm, "")
    .trim();
}

function stripTechnicalReplyArtifacts(text: string): string {
  return text
    .replace(/^Papildymas iš atsakymo.*$/gim, "")
    .replace(/\bGraph\s+[A-Za-z0-9+/=]{24,}\b/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function hasUsefulReplyComment(text: string): boolean {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return false;
  if (compact === "(tuščias tekstas)") return false;
  if (compact.length < 20) return false;
  return true;
}

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
  const syncMode = (process.env.MAIL_GRAPH_SYNC_MODE ?? "unread").trim().toLowerCase();
  const mailbox = graphMailboxUser();
  const client = await getGraphClient();

  const details: string[] = [];
  let created = 0;
  let skipped = 0;

  let listReq = client
    .api(`/users/${encodeURIComponent(mailbox)}/mailFolders/inbox/messages`)
    .top(50)
    .select("id,subject,internetMessageId,bodyPreview");
  if (syncMode === "recent") {
    // Paskutiniai 50 (įskaitant perskaitytus), naujausi pirmi.
    listReq = listReq.orderby("receivedDateTime desc");
    details.push("Graph sync režimas: recent (paskutiniai 50, read+unread).");
  } else {
    // Numatytai: tik neperskaityti, seniausi pirmi.
    listReq = listReq.filter("isRead eq false").orderby("receivedDateTime asc");
    details.push("Graph sync režimas: unread (tik neperskaityti).");
  }

  const list = await listReq.get();

  const itemMap = new Map<string, GraphMessageListItem>();
  for (const row of (list.value ?? []) as GraphMessageListItem[]) {
    itemMap.set(row.id, row);
  }

  // Perskaityti laiškai (pvz. Furninova RE su loading list) kitaip niekada nepatektų į sync.
  const skipReadPass = process.env.MAIL_GRAPH_SKIP_READ_PASS === "true";
  const lookbackHours = Number(process.env.MAIL_GRAPH_READ_LOOKBACK_HOURS ?? 96);
  if (!skipReadPass && syncMode !== "recent") {
    const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();
    try {
      const readList = await client
        .api(`/users/${encodeURIComponent(mailbox)}/mailFolders/inbox/messages`)
        .filter(`isRead eq true and receivedDateTime ge ${since}`)
        .orderby("receivedDateTime desc")
        .top(40)
        .select("id,subject,internetMessageId,bodyPreview")
        .get();
      let readAdded = 0;
      for (const row of (readList.value ?? []) as GraphMessageListItem[]) {
        if (!itemMap.has(row.id)) {
          itemMap.set(row.id, row);
          readAdded += 1;
        }
      }
      if (readAdded > 0) {
        details.push(
          `Papildomai įtraukta ${readAdded} perskaitytų laiškų (už ${lookbackHours} val.).`,
        );
      }
    } catch {
      details.push("Perskaitytų laiškų papildomas rinkinys nepavyko (Graph filtras).");
    }
  }

  const items = [...itemMap.values()];
  if (items.length === 0) {
    details.push("Nėra apdorotinų laiškų (neišsiųstų / perskaitytų rinkinyje).");
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

    const full = await client
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

    const imh = (full as { internetMessageHeaders?: { name?: string; value?: string }[] })
      .internetMessageHeaders;
    const isReply = isLikelyReplySubject(subject) || hasInReplyToFromGraphHeaders(imh);

    let existingThreadOrder: ThreadOrderRow | null = convId
      ? await prisma.order.findFirst({
          where: { conversationId: convId },
          select: threadOrderSelect,
        })
      : null;

    // Jei tai reply ir turim jau užsakymą toje pačioje gijoje — vėliau atnaujinsim (ne praleidžiam).
    // Jei reply, bet nėra užsakymo — LEIDŽIAM sukurti naują, jei praeina whitelist + DI.
    // Taip neprarandam svarbių gamintojo reply (pvz. „ready for pickup“) net jei pradinio laiško neimportavom.
    if (isReply && !existingThreadOrder) {
      details.push(`${item.id}: atsakymas (RE / In-Reply-To) — gijos užsakymo nėra, bandysim kurti naują iš reply`);
    }
    // Jei nėra reply, bet gijoje jau yra užsakymas — saugom nuo dublikatų.
    if (!isReply && existingThreadOrder) {
      skipped += 1;
      details.push(`${item.id}: ta pati gija — užsakymas jau sukurtas (${existingThreadOrder.internalId})`);
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
    textBody = trimQuotedMailHistory(textBody || "(tuščias tekstas)");

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
    const manufacturerFromMatch = matchesManufacturerRuleByFromOnly(fromAddr);

    if (!existingThreadOrder && isReply && manufacturerFromMatch) {
      const loadRef = extractFurninovaLoadingListRef(subject, textBody);
      if (loadRef) {
        existingThreadOrder = await findOrderByLoadingListRef(loadRef, fromAddr);
        if (existingThreadOrder) {
          details.push(
            `${item.id}: susietas su ${existingThreadOrder.internalId} pagal loading list ${loadRef}`,
          );
        }
      }
    }

    if (isReply && !manufacturerFromMatch) {
      skipped += 1;
      details.push(`${item.id}: atsakymas iš ne gamintojo siuntėjo (${fromAddr}) — praleista`);
      continue;
    }

    const allowed = await isAllowedSender(fromAddr, subject);
    if (!allowed) {
      skipped += 1;
      details.push(`${item.id}: siuntėjas ne whitelist'e (${fromAddr})`);
      continue;
    }

    const intent = await classifyMailPickupIntent({
      subject,
      bodyText: textBody,
      attachmentNames: attachments.map((a) => a.name).filter((n): n is string => Boolean(n?.trim())),
    });
    if (!intent.importOrder) {
      skipped += 1;
      details.push(`${item.id}: DI paėmimo filtras — neimportuojama (${intent.reason})`);
      continue;
    }

    const attachmentTextChunks = await extractAttachmentTexts(attachments);
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

    const potentialDuplicateOrder =
      !existingThreadOrder && !isReply
        ? await findPotentialDuplicateOrder({
            fromAddr,
            subject,
            pickupReference: parsed.pickupReference,
            pickupAddress: parsed.pickupAddress,
          })
        : null;

    const hasStructuredReplyData = Boolean(
      (parsed.pickupAddress && parsed.pickupAddress !== "Adresas laiške") ||
        parsed.pickupReference ||
        parsed.weightKg !== null ||
        parsed.volumeM3 !== null ||
        parsed.cargoValue !== null,
    );
    const replyCommentBody = stripTechnicalReplyArtifacts(extractReplyCommentBody(parsed.shipperComment));
    const shouldAppendReplyComment =
      hasUsefulReplyComment(replyCommentBody) &&
      (!isReply || hasStructuredReplyData);
    const appendBlock = shouldAppendReplyComment
      ? [
          "",
          `---`,
          `Papildymas iš atsakymo`,
          `Tema: ${subject}`,
          `Nuo: ${fromAddr}`,
          `---`,
          replyCommentBody,
        ]
          .filter(Boolean)
          .join("\n")
      : "";
    const shouldUpdateReviewState = hasStructuredReplyData || Boolean(extraReview);

    const order = existingThreadOrder || potentialDuplicateOrder
      ? await prisma.order.update({
          where: { id: (existingThreadOrder ?? potentialDuplicateOrder)!.id },
          data: {
            // Atnaujinam tik jei naujas parsingas turi kažką naudingo; nesugadinam jau suvestų laukų.
            manufacturer: (parsed.manufacturer ?? (existingThreadOrder ?? potentialDuplicateOrder)!.manufacturer).slice(0, 200),
            country: (parsed.country ?? (existingThreadOrder ?? potentialDuplicateOrder)!.country).slice(0, 120),
            pickupAddress: (parsed.pickupAddress ?? (existingThreadOrder ?? potentialDuplicateOrder)!.pickupAddress).slice(0, 500),
            ...(parsed.palletDimensions
              ? { palletDimensions: parsed.palletDimensions.slice(0, 2000) }
              : {}),
            pickupReference: (
              (typeof parsed.pickupReference === "string" && parsed.pickupReference.trim()
                ? parsed.pickupReference
                : (existingThreadOrder ?? potentialDuplicateOrder)!.pickupReference) ?? ""
            ).slice(0, 2000),
            weightKg: parsed.weightKg ?? undefined,
            volumeM3: parsed.volumeM3 ?? undefined,
            cargoValue: parsed.cargoValue ?? undefined,
            shipperComment: ((existingThreadOrder ?? potentialDuplicateOrder)!.shipperComment + appendBlock).slice(0, 50000),
            sourceFromEmail: fromAddr.slice(0, 320),
            emailSubject: subject.slice(0, 500),
            attachmentNamesJson: attachmentNames ?? (existingThreadOrder ?? potentialDuplicateOrder)!.attachmentNamesJson,
            reviewRequired: shouldUpdateReviewState
              ? parsed.reviewRequired || Boolean(extraReview)
              : (existingThreadOrder ?? potentialDuplicateOrder)!.reviewRequired,
            reviewNotes: shouldUpdateReviewState ? mergedNotes : (existingThreadOrder ?? potentialDuplicateOrder)!.reviewNotes,
            parsedConfidence: parsed.parsedConfidence,
            status: "pending_review",
          },
        })
      : await prisma.order.create({
          data: {
            internalId: await allocateNextInternalId(),
            manufacturer: (parsed.manufacturer ?? fromName).slice(0, 200),
            country: (
              (parsed.country ?? "").trim() ||
              countryLabelFromRoute(inferRouteFromSubject(subject)) ||
              "Patikrinkite laiške"
            ).slice(0, 120),
            pickupAddress: (parsed.pickupAddress ?? "Adresas laiške").slice(0, 500),
            palletDimensions: (parsed.palletDimensions ?? "").slice(0, 2000),
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
            conversationId: convId,
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
      `${existingThreadOrder || potentialDuplicateOrder ? "Atnaujinta" : "Sukurta"} ${order.internalId} iš Graph ${item.id} (${subject})${
        parsed.reviewRequired ? " [reikia peržiūros]" : ""
      }`,
    );
  }

  return { created, skipped, details };
}
