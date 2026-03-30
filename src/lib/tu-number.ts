import { prisma } from "@/lib/prisma";

export async function allocateNextInternalId(): Promise<string> {
  const year = new Date().getFullYear();
  return prisma.$transaction(async (tx) => {
    const current = await tx.tuCounter.findUnique({ where: { year } });
    const nextSeq = (current?.seq ?? 0) + 1;
    await tx.tuCounter.upsert({
      where: { year },
      create: { year, seq: nextSeq },
      update: { seq: nextSeq },
    });
    return `TU#${year}${String(nextSeq).padStart(4, "0")}`;
  });
}
