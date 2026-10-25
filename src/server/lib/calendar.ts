import { DomainError } from "./errors";

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;

export function isValidDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

export function isValidMonth(value: string): boolean {
  const match = MONTH_PATTERN.exec(value);
  return !!match && Number(match[2]) >= 1 && Number(match[2]) <= 12;
}

export function assertDate(value: unknown, field = "date"): string {
  if (typeof value !== "string" || !isValidDate(value)) {
    throw new DomainError(422, "VALIDATION_ERROR", `${field} must be a real calendar date in YYYY-MM-DD form.`, {
      [field]: ["Enter a valid date (YYYY-MM-DD)."],
    });
  }
  return value;
}

export function assertMonth(value: unknown, field = "month"): string {
  if (typeof value !== "string" || !isValidMonth(value)) {
    throw new DomainError(400, "MALFORMED_INPUT", `${field} must be YYYY-MM.`, { [field]: ["Use the YYYY-MM format."] });
  }
  return value;
}

export const monthOf = (date: string) => date.slice(0, 7);

export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** Half-open month range [start, endExclusive). */
export function monthBounds(month: string): { start: string; endExclusive: string } {
  return { start: `${month}-01`, endExclusive: `${addMonths(month, 1)}-01` };
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Local calendar date (YYYY-MM-DD) in the configured timezone. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function currentMonthIn(timeZone: string, now: Date = new Date()): string {
  return todayIn(timeZone, now).slice(0, 7);
}
