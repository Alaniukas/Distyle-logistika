import {
  parsePackingListJson,
  type PackingListParse,
} from "@/lib/packing-list-parser";

export type OrderQuantityFields = {
  weightKg: number | null;
  volumeM3: number | null;
  pickupAddress?: string | null;
  packingListBreakdownJson?: string | null;
  packingListValidated?: boolean;
  reviewRequired?: boolean;
};

export type QuantityValidationResult = {
  ok: boolean;
  errors: string[];
  breakdown: PackingListParse | null;
};

const TOL_KG = 0.5;
const TOL_M3 = 0.02;

export function validateOrderAgainstPackingList(
  order: OrderQuantityFields,
): QuantityValidationResult {
  const breakdown = parsePackingListJson(order.packingListBreakdownJson);
  const errors: string[] = [];

  if (!breakdown) {
    if (order.packingListValidated) {
      errors.push("Packing list pažymėtas kaip patvirtintas, bet duomenų nėra.");
    }
    return { ok: errors.length === 0, errors, breakdown: null };
  }

  const { totals } = breakdown;
  if (order.weightKg != null) {
    if (Math.abs(order.weightKg - totals.grossKg) > TOL_KG) {
      errors.push(
        `Svoris ${order.weightKg} kg nesutampa su packing list (${totals.grossKg} kg).`,
      );
    }
  } else {
    errors.push("Nenurodytas svoris (kg).");
  }

  if (order.volumeM3 != null) {
    if (Math.abs(order.volumeM3 - totals.volumeM3) > TOL_M3) {
      errors.push(
        `Tūris ${order.volumeM3} m³ nesutampa su packing list (${totals.volumeM3} m³).`,
      );
    }
  } else {
    errors.push("Nenurodytas tūris (m³).");
  }

  return { ok: errors.length === 0, errors, breakdown };
}

export function computePackingListValidated(
  order: OrderQuantityFields,
): boolean {
  const { ok, breakdown } = validateOrderAgainstPackingList(order);
  if (!breakdown) return false;
  const warnings = breakdown.warnings ?? [];
  return ok && warnings.length === 0;
}

export function canSendOrderToCarriers(order: OrderQuantityFields): {
  allowed: boolean;
  message: string | null;
} {
  if (order.reviewRequired) {
    return {
      allowed: false,
      message: "Užsakymas pažymėtas „reikia peržiūros“. Patikrinkite duomenis prieš siuntimą.",
    };
  }

  const validation = validateOrderAgainstPackingList(order);
  if (order.packingListBreakdownJson && !validation.ok) {
    return {
      allowed: false,
      message: validation.errors.join(" "),
    };
  }

  if (!order.pickupAddress?.trim() || order.pickupAddress === "Adresas laiške") {
    return {
      allowed: false,
      message: "Nurodykite pakrovimo adresą prieš siuntimą vežėjams.",
    };
  }

  if (order.weightKg == null || order.volumeM3 == null) {
    return {
      allowed: false,
      message: "Nurodykite svorį ir tūrį prieš siuntimą vežėjams.",
    };
  }

  return { allowed: true, message: null };
}
