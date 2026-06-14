import { prisma } from "@/lib/prisma";
import { matchesManufacturerRuleByFromOnly } from "@/lib/manufacturer-inbound-rules";

function normalize(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Tikslūs el. paštai (papildomai prie gamintojų From taisyklių):
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
 * Ar leidžiama importuoti laišką pagal siuntėją.
 *
 * Leidžiama tik jei:
 * 1) From sutampa su gamintojo taisykle (`manufacturer-inbound-rules.json` — tik el. pašto fragmentas, NE tema), arba
 * 2) tikslus el. paštas yra DB AllowedSender / ALLOWED_SENDERS.
 *
 * Temos raktai (bolia, furninova ir pan.) NĖRA whitelist — kitaip bet kas su RE: [Bolia] praeitų.
 */
export async function isAllowedSender(email: string, _subject?: string): Promise<boolean> {
  const normalized = normalize(email);
  if (!normalized) return false;

  if (matchesManufacturerRuleByFromOnly(email)) {
    return true;
  }

  const allowed = await getAllowedSenders();
  if (allowed.size === 0) {
    return process.env.MAIL_ALLOW_ALL_WHEN_WHITELIST_EMPTY === "true";
  }
  return allowed.has(normalized);
}
