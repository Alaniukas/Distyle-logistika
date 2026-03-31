import { prisma } from "@/lib/prisma";
import {
  matchesManufacturerRuleByFromOnly,
  matchesN8nManufacturerRules,
} from "@/lib/manufacturer-inbound-rules";

function normalize(email: string): string {
  return email.trim().toLowerCase();
}

/** Domenai (kableliais), kuriems neleidžiama „tik pagal temą“ — reikia atitikimo From pagal manufacturer-inbound-rules. */
function blockedImportDomains(): string[] {
  const raw =
    process.env.MAIL_IMPORT_BLOCK_FROM_DOMAINS ??
    "distyle.lt";
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function senderDomainIsBlockedForSubjectOnlyMatch(fromAddress: string): boolean {
  const at = fromAddress.lastIndexOf("@");
  if (at < 0) return false;
  const domain = fromAddress.slice(at + 1).toLowerCase();
  for (const b of blockedImportDomains()) {
    if (domain === b || domain.endsWith(`.${b}`)) return true;
  }
  return false;
}

/**
 * Tikslūs el. paštai (papildomai prie n8n taisyklių iš `manufacturer-inbound-rules.json`):
 * 1) DB AllowedSender, jei yra bent vienas aktyvus;
 * 2) kitu atveju — .env ALLOWED_SENDERS.
 */
export async function getAllowedSenders(): Promise<Set<string>> {
  const fromDb = await prisma.allowedSender.findMany({
    where: { isActive: true },
    select: { email: true },
  });
  if (fromDb.length > 0) {
    return new Set(fromDb.map((x) => normalize(x.email)));
  }
  const envList = (process.env.ALLOWED_SENDERS ?? "")
    .split(",")
    .map((s) => normalize(s))
    .filter(Boolean);
  return new Set(envList);
}

/**
 * 1) Pirmiausia — n8n „Gamintojai“ taisyklės (`src/data/manufacturer-inbound-rules.json`):
 *    tema turi key ARBA From turi email fragmentą (kaip n8n Code node).
 * 2) Tada — tikslus sąrašas: DB AllowedSender arba ALLOWED_SENDERS.
 * 3) Jei (2) tuščia — niekas nepraeina, nebent MAIL_ALLOW_ALL_WHEN_WHITELIST_EMPTY=true.
 */
export async function isAllowedSender(email: string, subject?: string): Promise<boolean> {
  const subj = subject ?? "";
  if (matchesN8nManufacturerRules(email, subj)) {
    if (
      senderDomainIsBlockedForSubjectOnlyMatch(email) &&
      !matchesManufacturerRuleByFromOnly(email)
    ) {
      return false;
    }
    return true;
  }

  const allowed = await getAllowedSenders();
  if (allowed.size === 0) {
    return process.env.MAIL_ALLOW_ALL_WHEN_WHITELIST_EMPTY === "true";
  }
  return allowed.has(normalize(email));
}

