import type { Client } from "@microsoft/microsoft-graph-client";
import { ResponseType } from "@microsoft/microsoft-graph-client";
import { getGraphClient, graphMailboxUser } from "@/lib/graph-client";
import type { SyncMailResult } from "@/lib/imap-sync";
import {
  bodyTextForIngest,
  extractAttachmentTexts,
  parseOrderFromMailSources,
  tryExtractPackingListFromAttachments,
  resolveGraphMessageText,
  type GraphAttachment,
} from "@/lib/mail-ingest-parser";
import {
  hasInReplyToFromGraphHeaders,
  isLikelyReplySubject,
  mailSubjectFilterFromEnv,
  subjectMatchesOptionalFilter,
} from "@/lib/inbound-mail-rules";
import { classifyMailPickupIntent } from "@/lib/mail-pickup-intent";
import {
  extractFurninovaLoadingListRef,
  resolveManufacturerEmailFromBody,
} from "@/lib/manufacturer-mail-extract";
import { findManufacturerInboundRule } from "@/lib/manufacturer-inbound-rules";
import {
  resolveOrderCountry,
  resolveOrderManufacturer,
} from "@/lib/parsed-order-sanitize";
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
  hasAttachments?: boolean;
};

function mergeListIntoMap(
  map: Map<string, GraphMessageListItem>,
  rows: GraphMessageListItem[],
): number {
  let added = 0;
  for (const row of rows) {
    if (!map.has(row.id)) {
      map.set(row.id, row);
      added += 1;
    }
  }
  return added;
}

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
  status: string;
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
  status: true,
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

function isPrismaUniqueViolation(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code: string }).code === "P2002"
  );
}

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
}): Promise<ThreadOrderRow | null> {
  const recent = await prisma.order.findMany({
    where: {
      source: "graph",
      sourceFromEmail: input.fromAddr,
      createdAt: { gte: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30) },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      ...threadOrderSelect,
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

function mergeAttachmentNamesJson(
  incoming: string | null,
  existing: string | null,
): string | null {
  const parse = (raw: string | null): string[] => {
    if (!raw?.trim()) return [];
    try {
      const arr = JSON.parse(raw) as unknown;
      if (!Array.isArray(arr)) return [];
      return arr.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
    } catch {
      return [];
    }
  };
  const merged = [...new Set([...parse(existing), ...parse(incoming)])];
  return merged.length > 0 ? JSON.stringify(merged) : incoming ?? existing;
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
  const listTop = Math.max(10, Math.min(500, Number(process.env.MAIL_GRAPH_LIST_TOP ?? 200)));
  const mailbox = graphMailboxUser();
  const client = await getGraphClient();

  const details: string[] = [];
  let created = 0;
  let skipped = 0;

  let listReq = client
    .api(`/users/${encodeURIComponent(mailbox)}/mailFolders/inbox/messages`)
    .top(listTop)
    .select("id,subject,internetMessageId,bodyPreview,hasAttachments");
  if (syncMode === "recent") {
    // Paskutiniai N (įskaitant perskaitytus), naujausi pirmi.
    listReq = listReq.orderby("receivedDateTime desc");
    details.push(`Graph sync režimas: recent (paskutiniai ${listTop}, read+unread).`);
  } else {
    // Numatytai: tik neperskaityti. SVARBU: naujausi pirmi, kad senų unread "šiukšlių"
    // backlogas neužkimštų top ribos ir nepradangintų naujų laiškų.
    const lookbackHours = Number(process.env.MAIL_GRAPH_UNREAD_LOOKBACK_HOURS ?? 336);
    const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();
    listReq = listReq
      .filter(`isRead eq false and receivedDateTime ge ${since}`)
      .orderby("receivedDateTime desc");
    details.push(
      `Graph sync režimas: unread (tik neperskaityti, naujausi pirmi, ${listTop}, lookback ${lookbackHours} val.).`,
    );
  }

  const list = await listReq.get();

  const itemMap = new Map<string, GraphMessageListItem>();
  for (const row of (list.value ?? []) as GraphMessageListItem[]) {
    itemMap.set(row.id, row);
  }

  // Perskaityti laiškai (pvz. Furninova RE su loading list) kitaip niekada nepatektų į sync.
  const skipReadPass = process.env.MAIL_GRAPH_SKIP_READ_PASS === "true";
  const lookbackHours = Number(process.env.MAIL_GRAPH_READ_LOOKBACK_HOURS ?? 96);
  const attachLookbackHours = Number(
    process.env.MAIL_GRAPH_ATTACH_LOOKBACK_HOURS ?? lookbackHours,
  );
  const attachReadTop = Number(process.env.MAIL_GRAPH_ATTACH_READ_TOP ?? 30);
  const listSelect = "id,subject,internetMessageId,bodyPreview,hasAttachments";

  if (!skipReadPass && syncMode !== "recent") {
    const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();
    const sinceAttach = new Date(Date.now() - attachLookbackHours * 60 * 60 * 1000).toISOString();

    try {
      const attachReadList = await client
        .api(`/users/${encodeURIComponent(mailbox)}/mailFolders/inbox/messages`)
        .filter(`hasAttachments eq true and receivedDateTime ge ${sinceAttach}`)
        .orderby("receivedDateTime desc")
        .top(attachReadTop)
        .select(listSelect)
        .get();
      const attachAdded = mergeListIntoMap(
        itemMap,
        (attachReadList.value ?? []) as GraphMessageListItem[],
      );
      if (attachAdded > 0) {
        details.push(
          `Papildomai įtraukta ${attachAdded} laiškų su priedais (perskaityti ar ne, ${attachLookbackHours} val.).`,
        );
      }
    } catch {
      details.push("Laiškų su priedais papildomas rinkinys nepavyko (Graph filtras).");
    }

    try {
      const readList = await client
        .api(`/users/${encodeURIComponent(mailbox)}/mailFolders/inbox/messages`)
        .filter(`isRead eq true and receivedDateTime ge ${since}`)
        .orderby("receivedDateTime desc")
        .top(40)
        .select(listSelect)
        .get();
      const readAdded = mergeListIntoMap(itemMap, (readList.value ?? []) as GraphMessageListItem[]);
      if (readAdded > 0) {
        details.push(
          `Papildomai įtraukta ${readAdded} perskaitytų laiškų (už ${lookbackHours} val.).`,
        );
      }
    } catch {
      details.push("Perskaitytų laiškų papildomas rinkinys nepavyko (Graph filtras).");
    }
  }

  const items = [...itemMap.values()].sort((a, b) => {
    const ah = a.hasAttachments ? 1 : 0;
    const bh = b.hasAttachments ? 1 : 0;
    return bh - ah;
  });
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
        "id,subject,internetMessageId,body,uniqueBody,bodyPreview,from,conversationId,internetMessageHeaders,hasAttachments",
      )
      .get()
      .catch(async () => {
        return client
          .api(`/users/${encodeURIComponent(mailbox)}/messages/${item.id}`)
          .select(
            "id,subject,internetMessageId,body,uniqueBody,bodyPreview,from,conversationId,hasAttachments",
          )
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
          orderBy: { createdAt: "desc" },
          select: threadOrderSelect,
        })
      : null;

    // Jei tai reply ir turim jau užsakymą toje pačioje gijoje — vėliau atnaujinsim (ne praleidžiam).
    // Jei reply, bet nėra užsakymo — LEIDŽIAM sukurti naują, jei praeina whitelist + DI.
    // Taip neprarandam svarbių gamintojo reply (pvz. „ready for pickup“) net jei pradinio laiško neimportavom.
    if (isReply && !existingThreadOrder) {
      details.push(`${item.id}: atsakymas (RE / In-Reply-To) — gijos užsakymo nėra, bandysim kurti naują iš reply`);
    }
    // Jei nėra reply, bet gijoje jau yra užsakymas — saugom nuo dublikatų,
    // nebent aiškiai nauja paėmimo nuoroda (antras krovinys toje pačioje Outlook gijoje).
    if (!isReply && existingThreadOrder) {
      const earlyRef = extractFurninovaLoadingListRef(
        subject,
        item.bodyPreview ?? "",
        [],
      );
      const existingRefs = pickupRefTokens(existingThreadOrder.pickupReference);
      if (
        earlyRef &&
        !existingRefs.has(earlyRef.toUpperCase())
      ) {
        details.push(
          `${item.id}: gijoje ${existingThreadOrder.internalId}, bet nauja nuoroda ${earlyRef} — kuriam atskirą užsakymą`,
        );
        existingThreadOrder = null;
      } else {
        skipped += 1;
        details.push(`${item.id}: ta pati gija — užsakymas jau sukurtas (${existingThreadOrder.internalId})`);
        continue;
      }
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

    const { fullBody, ingestBody, bodySource } = resolveGraphMessageText({
      body: (full as { body?: { contentType?: string; content?: string } }).body,
      uniqueBody: (full as { uniqueBody?: { contentType?: string; content?: string } }).uniqueBody,
      bodyPreview: (full as { bodyPreview?: string }).bodyPreview,
    });
    const rawBody = fullBody;
    if (bodySource === "uniqueBody") {
      details.push(`${item.id}: naudojamas Graph uniqueBody (tik naujausias atsakymas)`);
    }

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
    const embeddedManufacturerEmail = resolveManufacturerEmailFromBody(rawBody);
    const attNameList = attachments
      .map((a) => a.name)
      .filter((n): n is string => Boolean(n?.trim()));
    const textBody = bodyTextForIngest(subject, ingestBody, attNameList, {
      fromUniqueBody: bodySource === "uniqueBody",
    });
    const ingestFromAddr = embeddedManufacturerEmail ?? fromAddr;

    if (!existingThreadOrder && isReply) {
      const loadRef = extractFurninovaLoadingListRef(subject, `${ingestBody}\n${rawBody}`, attNameList);
      if (loadRef) {
        existingThreadOrder = await findOrderByLoadingListRef(loadRef, ingestFromAddr);
        if (existingThreadOrder) {
          details.push(
            `${item.id}: susietas su ${existingThreadOrder.internalId} pagal loading list ${loadRef}`,
          );
        }
      }
    }

    const allowed =
      (await isAllowedSender(fromAddr)) ||
      (embeddedManufacturerEmail ? await isAllowedSender(embeddedManufacturerEmail) : false);
    if (!allowed) {
      skipped += 1;
      details.push(`${item.id}: siuntėjas ne whitelist'e (${fromAddr})`);
      continue;
    }

    const intent = await classifyMailPickupIntent({
      subject,
      bodyText: textBody,
      attachmentNames: attNameList,
    });
    if (!intent.importOrder) {
      skipped += 1;
      details.push(`${item.id}: DI paėmimo filtras — neimportuojama (${intent.reason})`);
      continue;
    }

    const attachmentTextChunks = await extractAttachmentTexts(attachments);
    const packingList = tryExtractPackingListFromAttachments(attachments, {
      subject,
      bodyText: textBody,
      fromAddress: ingestFromAddr,
      manufacturerHint: null,
      attachmentTexts: attachmentTextChunks,
    });
    let extraReview = "";
    if (attachments.length > 0 && attachmentTextChunks.length === 0 && !packingList) {
      extraReview =
        " Priedai pridėti, bet teksto iš jų negauta (per didelis failas, tik vaizdas arba Graph negrąžino turinio).";
    }
    const parsed = await parseOrderFromMailSources({
      fromName: embeddedManufacturerEmail ? embeddedManufacturerEmail : fromName,
      fromAddress: ingestFromAddr,
      subject,
      bodyText: textBody,
      attachmentTexts: attachmentTextChunks,
      packingList,
    });
    const mergedNotes = [parsed.reviewNotes, extraReview].filter(Boolean).join(" ").trim() || null;

    const potentialDuplicateOrder = !existingThreadOrder
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
    const hasValuableImportData =
      Boolean(packingList) || hasStructuredReplyData || Boolean(parsed.packingListBreakdownJson);

    const mergeTarget = existingThreadOrder ?? potentialDuplicateOrder;
    if (!mergeTarget && !hasValuableImportData) {
      skipped += 1;
      details.push(`${item.id}: nėra struktūrinių logistikos duomenų — nekuriamas užsakymas`);
      continue;
    }

    const inboundRule = findManufacturerInboundRule(ingestFromAddr, subject);
    const mailBlock = `${textBody}\n${attachmentTextChunks.join("\n\n")}`;
    const resolvedManufacturer = resolveOrderManufacturer(
      parsed.manufacturer,
      subject,
      mailBlock,
      inboundRule,
      embeddedManufacturerEmail ?? fromName,
    );
    const resolvedCountry = resolveOrderCountry(parsed.country, subject, mailBlock);

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

    const newInternalId = mergeTarget ? null : await allocateNextInternalId();

    let order;
    try {
      order = await prisma.$transaction(async (tx) => {
        const dup = await tx.ingestedMail.findUnique({ where: { ingestKey } });
        if (dup) return null;

        const saved = mergeTarget
          ? await tx.order.update({
              where: { id: mergeTarget.id },
              data: {
                manufacturer: (
                  hasStructuredReplyData || packingList
                    ? resolvedManufacturer
                    : mergeTarget.manufacturer
                ).slice(0, 200),
                country: (
                  hasStructuredReplyData || packingList ? resolvedCountry : mergeTarget.country
                ).slice(0, 120),
                pickupAddress: (parsed.pickupAddress ?? mergeTarget.pickupAddress).slice(0, 500),
                ...(parsed.palletDimensions
                  ? { palletDimensions: parsed.palletDimensions.slice(0, 2000) }
                  : {}),
                pickupReference: (
                  (typeof parsed.pickupReference === "string" && parsed.pickupReference.trim()
                    ? parsed.pickupReference
                    : mergeTarget.pickupReference) ?? ""
                ).slice(0, 2000),
                weightKg: parsed.weightKg ?? undefined,
                volumeM3: parsed.volumeM3 ?? undefined,
                ...(parsed.packingListBreakdownJson
                  ? {
                      packingListBreakdownJson: parsed.packingListBreakdownJson,
                      packingListValidated: parsed.packingListValidated,
                    }
                  : {}),
                cargoValue: parsed.cargoValue ?? undefined,
                shipperComment: (mergeTarget.shipperComment + appendBlock).slice(0, 50000),
                sourceFromEmail: fromAddr.slice(0, 320),
                emailSubject: subject.slice(0, 500),
                attachmentNamesJson: mergeAttachmentNamesJson(
                  attachmentNames,
                  mergeTarget.attachmentNamesJson,
                ),
                reviewRequired: shouldUpdateReviewState
                  ? parsed.reviewRequired || Boolean(extraReview)
                  : mergeTarget.reviewRequired,
                reviewNotes: shouldUpdateReviewState ? mergedNotes : mergeTarget.reviewNotes,
                parsedConfidence: parsed.parsedConfidence,
                packingListBreakdownJson: parsed.packingListBreakdownJson,
                packingListValidated: parsed.packingListValidated,
                ...(mergeTarget.status === "sent_to_carriers"
                  ? {}
                  : { status: "pending_review" }),
              },
            })
          : await tx.order.create({
              data: {
                internalId: newInternalId!,
                manufacturer: resolvedManufacturer.slice(0, 200),
                country: resolvedCountry.slice(0, 120),
                pickupAddress: (parsed.pickupAddress ?? "Adresas laiške").slice(0, 500),
                palletDimensions: (parsed.palletDimensions ?? "").slice(0, 2000),
                weightKg: parsed.weightKg,
                volumeM3: parsed.volumeM3,
                cargoValue: parsed.cargoValue,
                shipperComment: parsed.shipperComment,
                pickupReference: (parsed.pickupReference ?? "").slice(0, 2000),
                packingListBreakdownJson: parsed.packingListBreakdownJson,
                packingListValidated: parsed.packingListValidated,
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

        await tx.ingestedMail.create({
          data: {
            ingestKey,
            orderId: saved.id,
          },
        });
        return saved;
      });

      if (!order) {
        skipped += 1;
        details.push(`${item.id}: jau apdorota (race / ${ingestKey.slice(0, 40)}…)`);
        continue;
      }
    } catch (e) {
      if (isPrismaUniqueViolation(e)) {
        skipped += 1;
        details.push(`${item.id}: jau apdorota (unikalus ingestKey)`);
        continue;
      }
      throw e;
    }

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
