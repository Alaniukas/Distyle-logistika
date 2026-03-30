/** Numatytasis modelis vežėjų laiškams ir DI srautams (žr. GEMINI_MODEL .env). */
export function geminiModelName(): string {
  return (process.env.GEMINI_MODEL ?? "gemini-2.5-flash").trim() || "gemini-2.5-flash";
}
