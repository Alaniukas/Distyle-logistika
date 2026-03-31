import data from "@/data/manufacturer-inbound-rules.json";

export type ManufacturerInboundRule = {
  key?: string;
  email?: string;
  name?: string;
  countryHint?: string;
};

const rules: ManufacturerInboundRule[] = data.rules ?? [];

/**
 * Ta pati logika kaip n8n „Gamintojai“ → Code in JavaScript2:
 * subject.includes(key) || from.includes(email)
 */
export function matchesN8nManufacturerRules(fromAddress: string, subject: string): boolean {
  const f = fromAddress.toLowerCase();
  const s = subject.toLowerCase();
  for (const r of rules) {
    const key = r.key?.trim().toLowerCase();
    const email = r.email?.trim().toLowerCase();
    if (email && f.includes(email)) return true;
    if (key && s.includes(key)) return true;
  }
  return false;
}

/** Tik jei bent viena taisyklė pataikė į From (ne į temą). Naudinga blokuoti „tema=tik raktas“ vidiniams siuntėjams. */
export function matchesManufacturerRuleByFromOnly(fromAddress: string): boolean {
  const f = fromAddress.toLowerCase();
  for (const r of rules) {
    const email = r.email?.trim().toLowerCase();
    if (email && f.includes(email)) return true;
  }
  return false;
}
