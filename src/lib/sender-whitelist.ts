import { prisma } from "@/lib/prisma";

function normalize(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Leidžiami siuntėjai:
 * 1) pirmiausia iš DB AllowedSender;
 * 2) jei DB tuščia — iš .env ALLOWED_SENDERS.
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

export async function isAllowedSender(email: string): Promise<boolean> {
  const allowed = await getAllowedSenders();
  if (allowed.size === 0) return true;
  return allowed.has(normalize(email));
}

