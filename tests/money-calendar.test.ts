import { describe, expect, it } from "vitest";
import { formatMinor, MAX_MINOR, minorToRupeeInput, parseMinorString, parseMoneyToMinor, parseSignedMinorString } from "@/server/lib/money";
import { addMonths, assertDate, daysInMonth, isValidDate, monthBounds, todayIn } from "@/server/lib/calendar";
import { DomainError } from "@/server/lib/errors";

describe("money", () => {
  it("parses decimal rupees to integer paise without floating point", () => {
    expect(parseMoneyToMinor("125.5")).toBe(12550n);
    expect(parseMoneyToMinor("0.1")).toBe(10n);
    expect(parseMoneyToMinor("0.29")).toBe(29n);
    expect(parseMoneyToMinor("999999999.99")).toBe(99999999999n);
  });

  it("rejects excess precision, exponents, signs, separators, and zero", () => {
    for (const bad of ["1.005", "1e3", "-5", "1,000", "NaN", "Infinity", "", "12.", ".5", "0"]) {
      expect(() => parseMoneyToMinor(bad)).toThrow(DomainError);
    }
    expect(parseMoneyToMinor("0", { allowZero: true })).toBe(0n);
  });

  it("enforces the per-value maximum", () => {
    expect(parseMinorString(MAX_MINOR.toString(), "amount")).toBe(MAX_MINOR);
    expect(() => parseMinorString((MAX_MINOR + 1n).toString(), "amount")).toThrow(DomainError);
    expect(() => parseMinorString("12.5", "amount")).toThrow(DomainError);
  });

  it("allows signed openings for credit-available balances", () => {
    expect(parseSignedMinorString("-2500", "openingBalanceMinor")).toBe(-2500n);
    expect(() => parseSignedMinorString("--1", "openingBalanceMinor")).toThrow(DomainError);
  });

  it("renders rupee inputs with exactly two decimals", () => {
    expect(minorToRupeeInput(150000n)).toBe("1500.00");
    expect(minorToRupeeInput("5")).toBe("0.05");
    expect(minorToRupeeInput(0n)).toBe("0.00");
    expect(minorToRupeeInput(-250n)).toBe("-2.50");
  });

  it("formats INR with en-IN grouping and two decimals", () => {
    expect(formatMinor(1234550n)).toBe("₹12,345.50");
    expect(formatMinor(10000000n)).toBe("₹1,00,000.00");
    expect(formatMinor(-5n)).toBe("-₹0.05");
  });
});

describe("calendar", () => {
  it("validates real calendar dates including leap years", () => {
    expect(isValidDate("2024-02-29")).toBe(true);
    expect(isValidDate("2026-02-29")).toBe(false);
    expect(isValidDate("2026-13-01")).toBe(false);
    expect(isValidDate("2026-1-01")).toBe(false);
    expect(() => assertDate("2026-02-30")).toThrow(DomainError);
  });

  it("computes half-open month bounds and month lengths", () => {
    expect(monthBounds("2026-12")).toEqual({ start: "2026-12-01", endExclusive: "2027-01-01" });
    expect(daysInMonth("2024-02")).toBe(29);
    expect(daysInMonth("2026-02")).toBe(28);
    expect(daysInMonth("2026-11")).toBe(30);
    expect(addMonths("2026-11", 3)).toBe("2027-02");
  });

  it("derives the local date in the configured timezone", () => {
    const justAfterUtcMidnight = new Date("2026-10-21T19:00:00Z"); // 00:30 on 22 Oct in Asia/Kolkata
    expect(todayIn("Asia/Kolkata", justAfterUtcMidnight)).toBe("2026-10-22");
    expect(todayIn("UTC", justAfterUtcMidnight)).toBe("2026-10-21");
  });
});
