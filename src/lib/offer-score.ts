import type { CarrierOffer } from "@prisma/client";

const DEFAULT_VAT_RATE = 0.21;

function vatRateFromEnv(): number {
  const raw = process.env.VAT_RATE?.trim();
  if (!raw) return DEFAULT_VAT_RATE;
  const n = Number(raw.replace(",", "."));
  return Number.isFinite(n) && n > 0 && n < 1 ? n : DEFAULT_VAT_RATE;
}

/** Kaina palyginimui (be PVM). */
export function priceComparableEur(
  o: Pick<CarrierOffer, "priceEur" | "vatNote">,
): number | null {
  if (o.priceEur == null || o.priceEur <= 0) return null;
  const note = (o.vatNote ?? "").toLowerCase();
  if (/\b(su\s+pvm|su\s+vat|incl\.?\s*vat|brutto)\b/.test(note)) {
    return o.priceEur / (1 + vatRateFromEnv());
  }
  return o.priceEur;
}

/**
 * Mažesnis balas = geriau (EUR be PVM per dieną). Jei trūksta duomenų — null.
 */
export function offerValueScore(
  o: Pick<CarrierOffer, "priceEur" | "termDays" | "vatNote">,
): number | null {
  const price = priceComparableEur(o);
  if (price == null) return null;
  if (o.termDays == null || o.termDays <= 0) return null;
  return price / o.termDays;
}

export function pickBestOfferId(
  offers: Pick<CarrierOffer, "id" | "priceEur" | "termDays" | "vatNote">[],
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
