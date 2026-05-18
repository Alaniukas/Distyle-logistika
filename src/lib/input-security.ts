const SIMPLE_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function hasHeaderInjectionChars(value: string): boolean {
  return /[\r\n]/.test(value);
}

export function normalizeTrustedText(
  value: unknown,
  maxLen: number,
): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen);
}

export function parseSafeEmail(value: unknown): string | null {
  const email = String(value ?? "").trim().toLowerCase();
  if (!email) return null;
  if (email.length > 320) return null;
  if (hasHeaderInjectionChars(email)) return null;
  if (!SIMPLE_EMAIL_RE.test(email)) return null;
  return email;
}
