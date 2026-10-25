import { DomainError } from "./errors";

export const MAX_MINOR = 1_000_000_000_000n;

const AMOUNT_PATTERN = /^(0|[1-9]\d{0,11})(\.\d{1,2})?$/;
const MINOR_PATTERN = /^(0|[1-9]\d{0,12})$/;

const inrFormatter = new Intl.NumberFormat("en-IN");

/** Parses a plain decimal rupee string (e.g. "125.5") into integer paise without floating point. */
export function parseMoneyToMinor(input: string, { allowZero = false }: { allowZero?: boolean } = {}): bigint {
  const text = input.trim();
  if (!AMOUNT_PATTERN.test(text)) {
    throw new DomainError(422, "VALIDATION_ERROR", "Enter an amount in rupees with at most 2 decimals.", {
      amount: ["Enter an amount in rupees with at most 2 decimals."],
    });
  }
  const [whole, fraction = ""] = text.split(".");
  const minor = BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2));
  return assertMinorRange(minor, allowZero);
}

/** Parses an integer paise value supplied by the API as a digit string. */
export function parseMinorString(input: unknown, field: string, { allowZero = false } = {}): bigint {
  if (typeof input !== "string" || !MINOR_PATTERN.test(input)) {
    throw new DomainError(400, "MALFORMED_INPUT", `${field} must be an integer number of paise.`, {
      [field]: [`${field} must be an integer number of paise.`],
    });
  }
  return assertMinorRange(BigInt(input), allowZero, field);
}

const SIGNED_MINOR_PATTERN = /^-?(0|[1-9]\d{0,12})$/;

/** Signed paise for account openings: positive debt on liabilities, negative credit available. */
export function parseSignedMinorString(input: unknown, field: string): bigint {
  if (typeof input !== "string" || !SIGNED_MINOR_PATTERN.test(input)) {
    throw new DomainError(400, "MALFORMED_INPUT", `${field} must be an integer number of paise.`, {
      [field]: [`${field} must be an integer number of paise.`],
    });
  }
  const minor = BigInt(input);
  if (minor > MAX_MINOR || minor < -MAX_MINOR) {
    throw new DomainError(422, "VALIDATION_ERROR", `${field} exceeds the allowed range.`, { [field]: ["Amount is out of range."] });
  }
  return minor;
}

function assertMinorRange(minor: bigint, allowZero: boolean, field = "amount"): bigint {
  if (minor > MAX_MINOR) {
    throw new DomainError(422, "VALIDATION_ERROR", `${field} exceeds the allowed maximum.`, { [field]: ["Amount is too large."] });
  }
  if (minor < 0n || (!allowZero && minor === 0n)) {
    throw new DomainError(422, "VALIDATION_ERROR", `${field} must be ${allowZero ? "zero or more" : "greater than zero"}.`, {
      [field]: [`${field} must be ${allowZero ? "zero or more" : "greater than zero"}.`],
    });
  }
  return minor;
}

/** Formats paise as INR with en-IN grouping, e.g. 1234550n -> "₹12,345.50". */
export function formatMinor(minor: bigint): string {
  const sign = minor < 0n ? "-" : "";
  const abs = minor < 0n ? -minor : minor;
  const rupees = abs / 100n;
  const paise = (abs % 100n).toString().padStart(2, "0");
  return `${sign}₹${inrFormatter.format(rupees)}.${paise}`;
}

/** Paise as a plain rupee string with exactly two decimals (for form inputs), e.g. 150000n -> "1500.00". */
export function minorToRupeeInput(minor: bigint | string): string {
  const value = BigInt(minor);
  const sign = value < 0n ? "-" : "";
  const abs = value < 0n ? -value : value;
  return `${sign}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
}
