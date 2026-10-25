import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/server/db";
import { getReports } from "@/server/domain/reports";
import { freshDb } from "./helpers";
import { addBudget, addTransaction, expenseInput, openAccount } from "./fixtures";

describe("filtered reports", () => {
  let db: Db;
  let chennaiAccount: { id: string };
  let hyderabadAccount: { id: string };

  beforeAll(async () => {
    db = await freshDb();
    chennaiAccount = await openAccount(db, "Reports Chennai", "SAVINGS", "1000000", "2026-01-01");
    hyderabadAccount = await openAccount(db, "Reports Hyderabad", "SAVINGS", "1000000", "2026-01-01");
  });

  it("reconciles location totals and applies location and source filters to actuals", async () => {
    await addTransaction(db, expenseInput({ sourceAccountId: chennaiAccount.id, amountMinor: 2500n, expenseLocation: "CHE", description: "Chennai groceries" }));
    await addTransaction(db, expenseInput({ sourceAccountId: hyderabadAccount.id, amountMinor: 4000n, expenseLocation: "HYD", description: "Hyderabad groceries" }));
    await addBudget(db, "2026-10", { provisions: 10000n });

    const all = await db.$transaction((tx) => getReports(tx, "2026-10"));
    expect(all.totalMinor).toBe("6500");
    expect(all.plannedMinor).toBe("10000");
    expect(all.locationTotals.reduce((sum, row) => sum + BigInt(row.totalMinor), 0n).toString()).toBe(all.totalMinor);
    expect(all.categories.find((category) => category.id === "groceries_everyday")?.actualMinor).toBe("6500");

    const chennai = await db.$transaction((tx) => getReports(tx, "2026-10", { expenseLocation: "CHE" }));
    expect(chennai.totalMinor).toBe("2500");
    expect(chennai.locationTotals.map((row) => row.totalMinor)).toEqual(["2500", "0"]);

    const source = await db.$transaction((tx) => getReports(tx, "2026-10", { sourceAccountId: hyderabadAccount.id }));
    expect(source.totalMinor).toBe("4000");
    expect(source.locationTotals.map((row) => row.totalMinor)).toEqual(["0", "4000"]);
    expect(source.trend).toHaveLength(6);
  });
});