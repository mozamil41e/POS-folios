/**
 * Business dates in Asia/Riyadh (R2.4b; CLAUDE.md §8). Saudi Arabia is UTC+3
 * all year (no daylight saving). Timestamps are stored in UTC; a document's
 * date ("today") is the Riyadh calendar day. Never use
 * new Date().toISOString().slice(0, 10) for it: between 00:00 and 03:00 in
 * Riyadh that is still yesterday.
 */
export const RIYADH_UTC_OFFSET_MS = 3 * 60 * 60 * 1000;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The Riyadh calendar date of `date` as YYYY-MM-DD. */
export function riyadhDate(date: Date = new Date()): string {
  return new Date(date.getTime() + RIYADH_UTC_OFFSET_MS).toISOString().slice(0, 10);
}

/** Today in Riyadh as YYYY-MM-DD. */
export const riyadhToday = (): string => riyadhDate(new Date());

/** The Riyadh calendar year of `date`. */
export function riyadhYear(date: Date = new Date()): number {
  return Number(riyadhDate(date).slice(0, 4));
}

/** YYYY-MM-DD and a real calendar day (2026-02-30 and 2026-13-01 are not). */
export function isValidIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}
