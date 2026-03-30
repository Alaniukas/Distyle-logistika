import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { countryLabelFromRoute, inferRouteFromSubject } from "@/lib/carriers";
import {
  isLikelyReplySubject,
  mailSubjectFilterFromEnv,
  subjectMatchesOptionalFilter,
} from "@/lib/inbound-mail-rules";
import { mailTlsOptions } from "@/lib/mail-tls";
import { prisma } from "@/lib/prisma";
import { isAllowedSender } from "@/lib/sender-whitelist";
import { allocateNextInternalId } from "@/lib/tu-number";

export type SyncMailResult = {
  created: number;
  skipped: number;
  details: string[];
};

function buildIngestKey(messageId: string | undefined, uid: number): string {
  const raw = messageId?.trim();
  if (raw && raw.length > 0) return raw.slice(0, 900);
  return `imap-uid-${uid}`;
}

export async function syncInboxFromImap(): Promise<SyncMailResult> {
  const host = process.env.IMAP_HOST;
  const user = process.env.IMAP_USER;
  const pass = process.env.IMAP_PASSWORD;
  const subjectFilter = mailSubjectFilterFromEnv();
  const markSeen = process.env.MAIL_MARK_SEEN === "true";

  if (!host || !user || pass === undefined || pass === "") {
    throw new Error(
      "Trūksta IMAP_HOST, IMAP_USER arba IMAP_PASSWORD. Microsoft 365: žr. komentarus faile imap-sync.ts",
    );
  }

  const port = Number(process.env.IMAP_PORT ?? 993);
  const details: string[] = [];
  let created = 0;
  let skipped = 0;

  const tls = mailTlsOptions();
  const client = new ImapFlow({
    host,
    port,
    secure: port !== 143,
    auth: { user, pass },
    logger: false,
    ...(tls ? { tls } : {}),
  });

  await client.connect();

  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const searchResult = await client.search({ seen: false });
      const uids = searchResult === false ? [] : searchResult;
      if (uids.length === 0) {
        details.push("Nėra neperskaitytų laiškų.");
      }

      for (const uid of uids) {
        const msg = await client.fetchOne(
          String(uid),
          { envelope: true, source: true },
          { uid: true },
        );
        if (!msg || !msg.source) {
          skipped += 1;
          details.push(`UID ${uid}: nepavyko nuskaityti turinio`);
          continue;
        }

        const parsed = await simpleParser(msg.source);
        const subject = parsed.subject ?? "";
        if (!subjectMatchesOptionalFilter(subjectFilter, subject)) {
          skipped += 1;
          details.push(
            `UID ${uid}: tema „${subject}“ — neatitinka filtro „${subjectFilter || "(išjungta)"}“`,
          );
          continue;
        }

        const inReply = parsed.inReplyTo;
        const hasReplyId =
          Array.isArray(inReply) ? inReply.some(Boolean) : Boolean(inReply && String(inReply).trim());
        if (hasReplyId || isLikelyReplySubject(subject)) {
          skipped += 1;
          details.push(`UID ${uid}: atsakymas (In-Reply-To / RE:) — praleidžiama`);
          continue;
        }

        const ingestKey = buildIngestKey(parsed.messageId, Number(uid));
        const existing = await prisma.ingestedMail.findUnique({
          where: { ingestKey },
        });
        if (existing) {
          skipped += 1;
          details.push(`UID ${uid}: jau apdorota (${ingestKey.slice(0, 40)}…)`);
          continue;
        }

        const fromAddr =
          parsed.from?.value[0]?.address ||
          parsed.from?.value[0]?.name ||
          "nežinomas@siuntėjas.lt";
        const fromName = parsed.from?.value[0]?.name || fromAddr;

        const allowed = await isAllowedSender(fromAddr);
        if (!allowed) {
          skipped += 1;
          details.push(`UID ${uid}: siuntėjas ne whitelist'e (${fromAddr})`);
          continue;
        }

        const textBody = (parsed.text || "").trim() || "(tuščias tekstas)";
        const firstLine =
          textBody.split(/\r?\n/).find((l) => l.trim().length > 0)?.trim() ||
          "Adresas laiške";

        const internalId = await allocateNextInternalId();
        const route = inferRouteFromSubject(subject);
        const countryGuess = countryLabelFromRoute(route) ?? "Patikrinkite laiške";

        const order = await prisma.order.create({
          data: {
            internalId,
            manufacturer: fromName.slice(0, 200),
            country: countryGuess.slice(0, 120),
            pickupAddress: firstLine.slice(0, 500),
            shipperComment: [
              `Tema: ${subject}`,
              `Nuo: ${fromAddr}`,
              "---",
              textBody,
            ].join("\n"),
            source: "imap",
            emailSubject: subject.slice(0, 500),
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
          await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
        }

        created += 1;
        details.push(`Sukurta ${order.internalId} iš UID ${uid} (${subject})`);
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }

  return { created, skipped, details };
}
