import type { CarrierOffer } from "@prisma/client";

/**
 * Mažesnis balas = geriau (EUR per dieną). Jei trūksta duomenų — null.
 */
export function offerValueScore(o: Pick<CarrierOffer, "priceEur" | "termDays">): number | null {
  if (o.priceEur == null || o.priceEur <= 0) return null;
  const days = o.termDays != null && o.termDays > 0 ? o.termDays : 1;
  return o.priceEur / days;
}

export function pickBestOfferId(
  offers: Pick<CarrierOffer, "id" | "priceEur" | "termDays">[],
): string | null {
  let bestId: string | null = null;
  let bestScore = Infinity;
  for (const o of offers) {
    const s = offerValueScore(o);
    if (s != null && s < bestScore) {
      bestScore = s;
      bestId = o.id;
    }
  }
  return bestId;
}
