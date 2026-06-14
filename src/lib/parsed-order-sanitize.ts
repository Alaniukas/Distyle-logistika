import { countryLabelFromRoute, inferRouteFromSubject } from "@/lib/carriers";
import {
  findManufacturerInboundRule,
  type ManufacturerInboundRule,
} from "@/lib/manufacturer-inbound-rules";

const PLACEHOLDER_COUNTRIES = new Set(["test", "testing", "xxx", "n/a", "na", "tbd"]);

const GARBAGE_MANUFACTURER_START =
  /^(thanks?|thank you|okay|ok[,!]?|best regards|kind regards|hello|hi|dear|sveiki|labas|ačiū|aciu|dėkoju|dekoju|yes|no|sure|please|sorry|noted|understood|gerai|supratau|sent:|from:|to:|cc:|subject:|tema:|nuo:)\b/i;

/** Ar reikšmė netinkama gamintojo laukui (pokalbio eilutė, data, klausimas). */
export function isGarbageManufacturerValue(value: string | null | undefined): boolean {
  const t = (value ?? "").trim();
  if (!t || t.length < 2) return true;
  if (t === "Nežinoma (patikrinkite laišką)") return true;
  if (GARBAGE_MANUFACTURER_START.test(t)) return true;
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return true;
  if (/^\d{1,2}[./]\d{1,2}[./]\d{2,4}/.test(t)) return true;
  if (/^\d{1,2}:\d{2}/.test(t)) return true;
  if (/^(mon|tue|wed|thu|fri|sat|sun|pirm|antr|treč|ketv|penk|šešt|sekm)/i.test(t)) {
    return true;
  }
  if (/\?$/.test(t)) return true;
  if (/^your order is\b/i.test(t)) return true;
  if (/^o kaip\b/i.test(t)) return true;
  if (/^čia\b/i.test(t) && /\?/.test(t)) return true;
  if (t.split(/\s+/).length > 7) return true;
  return false;
}

export function isPlaceholderCountry(value: string | null | undefined): boolean {
  const t = (value ?? "").trim().toLowerCase();
  return !t || PLACEHOLDER_COUNTRIES.has(t);
}

/** Gamintojas iš temos / turinio (ne pirmos laiško eilutės). */
export function manufacturerHintFromMailContext(subject: string, body: string): string | null {
  const rule = findManufacturerInboundRule("", subject);
  if (rule?.name) return rule.name;
  const block = `${subject}\n${body}`.toLowerCase();
  if (/\bfurninova\b/.test(block)) return "Furninova";
  if (/\bbolia\b/.test(block)) return "Bolia";
  if (/\bsaba\b|saba\s+italia/.test(block)) return "Saba Italia";
  if (/\beriks\b/.test(block)) return "Saba (per tarpininką)";
  return null;
}

export function resolveOrderManufacturer(
  parsed: string | null | undefined,
  subject: string,
  body: string,
  inboundRule?: ManufacturerInboundRule | null,
  fromName?: string | null,
): string {
  const hint =
    inboundRule?.name ??
    manufacturerHintFromMailContext(subject, body) ??
    (fromName && !isGarbageManufacturerValue(fromName) ? fromName.trim() : null);

  const candidate = (parsed ?? "").trim();
  if (candidate && !isGarbageManufacturerValue(candidate)) {
    return candidate.slice(0, 200);
  }
  if (hint) return hint.slice(0, 200);
  return "Nežinoma (patikrinkite laišką)";
}

export function resolveOrderCountry(
  parsed: string | null | undefined,
  subject: string,
  body?: string,
  attachmentText?: string,
): string {
  const candidate = (parsed ?? "").trim();
  if (candidate && !isPlaceholderCountry(candidate)) {
    return candidate.slice(0, 120);
  }
  const block = `${body ?? ""}\n${attachmentText ?? ""}`;
  const inferred = inferCountryFromBodyAndSubject(block, subject);
  if (inferred) return inferred;
  const route = countryLabelFromRoute(inferRouteFromSubject(subject));
  if (route) return route;
  return "Patikrinkite laiške";
}

function inferCountryFromBodyAndSubject(body: string, subject: string): string | null {
  const t = `${body}\n${subject}`.toLowerCase();
  if (
    /nyderland|nederland|netherlands|holland|zwijndrecht|merwedeweg|\bbolia\b|oranje transport|the netherlands/.test(
      t,
    )
  ) {
    return "Nyderlandai";
  }
  if (/italija|\bitaly\b|italia|furninova|saba italia|\bsrl\b.*ital|made in italy/.test(t)) {
    return "Italija";
  }
  if (/lenkija|\bpoland\b|polska|polski|warsaw|krakow|warszawa/.test(t)) {
    return "Lenkija";
  }
  return null;
}

/** Ar laiškas — tik mandagus atsakymas be logistikos duomenų. */
export function isConversationalOnlyBody(body: string): boolean {
  const t = body.trim();
  if (t.length > 280) return false;
  if (/\b(ready for collection|ready for pickup|loading list|packing list|pick[\s-]?up address|lista zaladunkowa)\b/i.test(t)) {
    return false;
  }
  if (/\b\d{2}W[/_]\d+/i.test(t)) return false;
  if (/\d+\s*(kg|m3|m³)\b/i.test(t)) return false;
  const lines = t
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return true;
  return lines.every((line) => isGarbageManufacturerValue(line) || line.length < 25);
}
