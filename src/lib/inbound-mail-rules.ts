/**
 * Taisyklės gamintojų laiškų importui (sinchronas), suderintos su n8n logika:
 * whitelist siuntėjai, pasirenkamas temos filtras, tik „pirmi“ laiškai (ne reply).
 */

/** Tuščia eilutė = be papildomo temos filtro (tik ALLOWED_SENDERS). */
export function mailSubjectFilterFromEnv(): string {
  return (process.env.MAIL_SUBJECT_FILTER ?? "").trim();
}

export function subjectMatchesOptionalFilter(filter: string, subject: string): boolean {
  const f = filter.trim().toLowerCase();
  if (!f) return true;
  return subject.toLowerCase().includes(f);
}

/** Temos prefiksai, būdingi atsakymams / peradresavimams. */
const REPLY_SUBJECT_PREFIX =
  /^\s*(re|aw|sv|vs|antw|fw|fwd|wg|ang|enc|odp|ref)\s*[:：]\s*/i;

export function isLikelyReplySubject(subject: string): boolean {
  return REPLY_SUBJECT_PREFIX.test(subject.trim());
}

type NamedHeader = { name?: string; value?: string };

export function hasInReplyToFromGraphHeaders(headers: NamedHeader[] | undefined): boolean {
  if (!headers?.length) return false;
  for (const h of headers) {
    const n = (h.name ?? "").toLowerCase();
    if (n === "in-reply-to" && (h.value ?? "").trim()) return true;
  }
  return false;
}

/**
 * Vercel Cron arba rankinis kvietimas: Bearer CRON_SECRET arba SYNC_SECRET.
 */
export function authorizeCronOrSyncRequest(req: Request): boolean {
  const secret =
    process.env.CRON_SECRET?.trim() ||
    process.env.SYNC_SECRET?.trim() ||
    "";
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  return token === secret;
}
