/** Display name cleanup: NFKC, trimmed, internal whitespace collapsed. */
export function cleanName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

/** Stable comparison key for uniqueness checks (Unicode-aware, not SQLite NOCASE). */
export function normalizeName(value: string): string {
  return cleanName(value).toLocaleLowerCase("en-US");
}
