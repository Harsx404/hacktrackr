/**
 * Attempts to parse a date string into an ISO 8601 string.
 * Returns null if parsing fails.
 */
export function parseDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/\s+/g, ' ');
  const d = new Date(cleaned);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * Returns how many days until the given ISO date.
 * Negative = past.
 */
export function daysUntil(isoDate: string): number {
  return Math.ceil((new Date(isoDate).getTime() - Date.now()) / 86_400_000);
}
