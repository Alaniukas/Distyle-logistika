/**
 * Gamintojų specifiniai heuristiniai ištraukimai (kai DI praleidžia struktūrinius laukus).
 */

import { matchesManufacturerRuleByFromOnly } from "@/lib/manufacturer-inbound-rules";

const EMBEDDED_FROM_RE = /(?:^|\n)\s*from:\s*[^<\n]*<([^>\s@]+@[^>\s]+)>/gi;

/** El. paštai iš „From: … <…>“ cituotose / peradresuotose dalyse. */
export function extractEmbeddedSenderEmails(body: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of body.replace(/\r/g, "").matchAll(EMBEDDED_FROM_RE)) {
    const addr = (m[1] ?? "").trim().toLowerCase();
    if (!addr || seen.has(addr)) continue;
    seen.add(addr);
    out.push(addr);
  }
  return out;
}

/** Pirmas įterptas siuntėjas, atitinkantis gamintojo taisykles (pvz. Dorota per FW iš orders@). */
export function resolveManufacturerEmailFromBody(body: string): string | null {
  for (const email of extractEmbeddedSenderEmails(body)) {
    if (matchesManufacturerRuleByFromOnly(email)) return email;
  }
  return null;
}

function normalizeFurninovaListToken(token: string): string | null {
  const slash = token.match(/(\d{2}W\/\d+(?:\/\d+)+\/(?:EXPO|EXKAUN))/i);
  if (slash?.[1]) return slash[1].toUpperCase();
  const under = token.match(/(\d{2}W)[_](\d+(?:_\d+)+)[_](EXPO|EXKAUN)/i);
  if (!under) return null;
  const week = under[1]!.toUpperCase();
  const mid = under[2]!.replace(/_/g, "/");
  const kind = under[3]!.toUpperCase();
  return `${week}/${mid}/${kind}`;
}

/** Saba Italia: adresas po „SABA ITALIA SRL“ iki Warehouse/Loading. */
export function extractSabaPickupAddress(text: string): string | null {
  const t = text.replace(/\r/g, "");
  if (!/saba\s+italia/i.test(t)) return null;

  const lines = t.split("\n").map((l) => l.trim()).filter(Boolean);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^saba\s+italia\s+srl$/i.test(lines[i]!)) {
      start = i + 1;
      break;
    }
  }
  if (start < 0) {
    for (let i = 0; i < lines.length; i++) {
      if (/saba\s+italia/i.test(lines[i]!)) {
        start = i + 1;
        break;
      }
    }
  }
  if (start < 0) return null;

  const addrLines: string[] = [];
  for (let i = start; i < lines.length && addrLines.length < 6; i++) {
    const line = lines[i]!;
    if (
      /^warehouse\s+hours/i.test(line) ||
      /^loading\s+details/i.test(line) ||
      /^the\s+sofas\s+are/i.test(line) ||
      /^to\s+avoid\s+any/i.test(line) ||
      /^thanks?\b/i.test(line) ||
      /^best\s+regards/i.test(line) ||
      /^---/.test(line)
    ) {
      break;
    }
    if (/^via\s+/i.test(line) || /^\d{4,5}\s+/i.test(line) || addrLines.length > 0) {
      addrLines.push(line);
      continue;
    }
    if (addrLines.length > 0) break;
  }

  const joined = addrLines.join(", ").replace(/\s+/g, " ").trim();
  return joined.length >= 10 ? joined.slice(0, 500) : null;
}

const DIM_LINE_RE =
  /\b(\d{2,4})\s*[x×]\s*(\d{2,4})\s*[x×]\s*(\d{2,4})\s*(cm|mm|m)?\b/gi;

/** Bolia: palečių matmenys (WxLxH + eilutės su matmenimis). */
export function extractBoliaPalletDimensions(text: string): string | null {
  const t = text.replace(/\r/g, "");
  if (!/\bbolia\b/i.test(t) && !/wxlxh/i.test(t)) return null;

  const parts: string[] = [];
  const palletCount = t.match(/(\d+)\s*pallets?\b/i);
  if (palletCount) parts.push(`${palletCount[1]} paletės`);

  if (/wxlxh/i.test(t)) parts.push("WxLxH");

  const dims: string[] = [];
  for (const m of t.matchAll(DIM_LINE_RE)) {
    const unit = (m[4] ?? "cm").toLowerCase();
    dims.push(`${m[1]} x ${m[2]} x ${m[3]} ${unit}`);
  }
  if (dims.length > 0) parts.push(...dims);

  const unique = [...new Set(parts)];
  if (unique.length === 0) return null;
  return unique.join("; ").slice(0, 2000);
}

export function isBoliaContext(manufacturer: string | null, subject: string, body: string): boolean {
  const ctx = `${manufacturer ?? ""}\n${subject}\n${body}`.toLowerCase();
  return ctx.includes("bolia");
}

export function isSabaContext(manufacturer: string | null, subject: string, body: string): boolean {
  const ctx = `${manufacturer ?? ""}\n${subject}\n${body}`.toLowerCase();
  return ctx.includes("saba italia") || ctx.includes("saba italia srl") || /\bsaba\b/.test(ctx);
}

/** Furninova loading list nr., pvz. 26W/22/2/EXPO ar 26W_24_2_EXPO.pdf. */
export function extractFurninovaLoadingListRef(
  subject: string,
  body?: string,
  attachmentNames?: string[],
): string | null {
  const text = `${subject}\n${body ?? ""}\n${(attachmentNames ?? []).join("\n")}`;
  const expo = text.match(/(\d{2}W\/\d+(?:\/\d+)+\/(?:EXPO|EXKAUN))/i);
  if (expo?.[1]) return expo[1].toUpperCase();
  const underscored = text.match(/(\d{2}W_\d+(?:_\d+)+_(?:EXPO|EXKAUN))/i);
  if (underscored?.[0]) {
    const norm = normalizeFurninovaListToken(underscored[0]);
    if (norm) return norm;
  }
  const lista = text.match(/lista\s+zaladunkowa\s+nr\s*[:\-]?\s*([A-Z0-9][A-Z0-9/._\-]*)/i);
  if (lista?.[1]) {
    const norm = normalizeFurninovaListToken(lista[1]);
    if (norm) return norm;
  }
  const generic = text.match(/loading\s+list\s+nr\s*[:\-]?\s*([A-Z0-9][A-Z0-9/._\-]*)/i);
  if (generic?.[1]) {
    const norm = normalizeFurninovaListToken(generic[1]);
    if (norm) return norm;
  }
  return null;
}
