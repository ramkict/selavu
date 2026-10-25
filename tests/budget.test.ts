import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/server/db";
import { createBudget, deleteBudget, getBudgetByMonth, updateBudget } from "@/server/domain/budgets";
import { updateTransaction } from "@/server/domain/transactions";
import { freshDb, ctx } from "./helpers";
import { addBudget, addTransaction, balanceOf, expenseInput, fullBudgetLines, openAccount } from "./fixtures";

describe("shared monthly budget", () => {
  let db: Db;
  let savings: { id: string };

  beforeAll(async () => {
    db = await freshDb();
    savings = await openAccount(db, "Budget Savings", "SAVINGS", "10000000", "2026-01-01");
  });

  it("matches CHE and HYD expenses in the same category to one shared detail", async () => {
    const che = await addTransaction(db, expenseInput({ sourceAccountId: savings.id, amountMinor: 100000n, date: "2026-10-03" }));
    const hyd = await addTransaction(db, expenseInput({ sourceAccountId: savings.id, amountMinor: 50000n, date: "2026-10-04", expenseLocation: "HYD" }));
    expect(che.budgetMatch).toBe("UNBUDGETED");
    expect(hyd.budgetMatch).toBe("UNBUDGETED");

    const budget = await addBudget(db, "2026-10", { groceries: 200000n });
    expect(budget.details.find((d) => d.subcategoryId === "groceries")).toMatchObject({
      budgetAmountMinor: "200000",
      spendMinor: "150000",
      balanceMinor: "50000",
    });
    expect(budget.totals.formatted.remaining).toBe("₹500.00");
    expect(budget.totals.budgetUsedMinor).toBe("150000");
    expect(budget.totals.currentSpendingMinor).toBe("150000");

    const reloaded = await db.transaction.findMany({ where: { id: { in: [che.id, hyd.id] } }, select: { budgetDetailId: true } });
    expect(reloaded.every((r) => r.budgetDetailId !== null)).toBe(true);
    expect(new Set(reloaded.map((r) => r.budgetDetailId)).size).toBe(1);
  });

  it("refuses a second budget for the same month and opens the existing one", async () => {
    await expect(addBudget(db, "2026-10", {})).rejects.toMatchObject({ status: 409 });
    expect((await db.$transaction((tx) => getBudgetByMonth(tx, "2026-10")))?.month).toBe("2026-10");
  });

  it("requires every active catalog child to be reviewed, including explicit zeros", async () => {
    const lines = (await fullBudgetLines(db)).slice(1);
    await expect(db.$transaction((tx) => createBudget(tx, { month: "2026-11", lines }, ctx))).rejects.toMatchObject({ status: 422 });
  });

  it("creates a budget with every amount and the total set to zero", async () => {
    const budget = await addBudget(db, "2026-12", {});
    expect(budget.details.length).toBeGreaterThan(0);
    expect(budget.details.every((line) => line.budgetAmountMinor === "0")).toBe(true);
    expect(budget.totals.totalProvisionedMinor).toBe("0");
    expect(budget.totals.formatted.totalProvisioned).toBe("₹0.00");
  });

  it("a zero plan with actual spend is explicit overspend with null utilization", async () => {
    await addTransaction(db, expenseInput({ sourceAccountId: savings.id, amountMinor: 30000n, date: "2026-10-12", subcategoryId: "dining_out" }));
    const master = await db.$transaction((tx) => getBudgetByMonth(tx, "2026-10"));
    const dining = master!.details.find((d) => d.subcategoryId === "dining_out")!;
    expect(dining.budgetAmountMinor).toBe("0");
    expect(dining.spendMinor).toBe("30000");
    expect(dining.utilizationBps).toBeNull();
    expect(dining.alert).toBe(false);
  });

  it("keeps account balances when the budget is deleted and rematches when recreated", async () => {
    const balance = await balanceOf(db, savings.id);
    const budget = (await db.$transaction((tx) => getBudgetByMonth(tx, "2026-10")))!;
    await expect(db.$transaction((tx) => deleteBudget(tx, budget.id, budget.version + 5, ctx))).rejects.toMatchObject({ status: 409 });
    await db.$transaction((tx) => deleteBudget(tx, budget.id, budget.version, ctx));

    expect(await db.budgetMaster.count({ where: { month: "2026-10" } })).toBe(0);
    expect(await db.transaction.count({ where: { budgetDetailId: { not: null } } })).toBe(0);
    expect(await db.transaction.count({ where: { date: { startsWith: "2026-10" } } })).toBeGreaterThan(0);
    expect(await balanceOf(db, savings.id)).toBe(balance);

    const recreated = await addBudget(db, "2026-10", { groceries: 150000n });
    expect(recreated.details.find((d) => d.subcategoryId === "groceries")!.spendMinor).toBe("150000");
  });

  it("updates planned amounts with version checks and recalculates remaining provision", async () => {
    const budget = (await db.$transaction((tx) => getBudgetByMonth(tx, "2026-10")))!;
    const lines = (await fullBudgetLines(db, { groceries: 300000n })).map((l) => ({ ...l }));
    await expect(db.$transaction((tx) => updateBudget(tx, budget.id, budget.version + 1, { lines }, ctx))).rejects.toMatchObject({ status: 409 });
    const updated = await db.$transaction((tx) => updateBudget(tx, budget.id, budget.version, { lines }, ctx));
    expect(updated.version).toBe(budget.version + 1);
    expect(updated.totals.totalProvisionedMinor).toBe("300000");
    expect(updated.totals.budgetUsedMinor).toBe("180000");
    expect(updated.totals.remainingMinor).toBe("120000");
  });

  it("backdating an expense out of the budgeted month clears its link and refreshes totals", async () => {
    const budget = (await db.$transaction((tx) => getBudgetByMonth(tx, "2026-10")))!;
    const t = await addTransaction(db, expenseInput({ sourceAccountId: savings.id, amountMinor: 25000n, date: "2026-10-20" }));
    expect(t.budgetMatch).toBe("MATCHED");
    const before = (await db.$transaction((tx) => getBudgetByMonth(tx, "2026-10")))!;
    await db.$transaction((tx) =>
      updateTransaction(
        tx,
        t.id,
        t.version,
        {
          type: "EXPENSE",
          financialKind: null,
          date: "2026-09-30",
          description: t.description,
          notes: null,
          amountMinor: 25000n,
          sourceAccountId: savings.id,
          destinationAccountId: "sys_expense",
          paymentModeId: "upi",
          expenseLocation: "CHE",
          categoryId: "food",
          subcategoryId: "groceries",
          incomeType: null,
          incomeSourceLabel: null,
          recurring: false,
        },
        ctx,
      ),
    );
    const after = (await db.$transaction((tx) => getBudgetByMonth(tx, "2026-10")))!;
    expect(BigInt(after.totals.budgetUsedMinor)).toBe(BigInt(before.totals.budgetUsedMinor) - 25000n);
    expect(after.version).toBe(budget.version);
    const moved = await db.transaction.findUniqueOrThrow({ where: { id: t.id } });
    expect(moved.budgetDetailId).toBeNull();
  });

  it("budget totals separate provisioned amounts from consumption", async () => {
    const budget = (await db.$transaction((tx) => getBudgetByMonth(tx, "2026-10")))!;
    const provisioned = BigInt(budget.totals.totalProvisionedMinor);
    const used = BigInt(budget.totals.budgetUsedMinor);
    expect(BigInt(budget.totals.remainingMinor)).toBe(provisioned - used);
    expect(BigInt(budget.totals.currentSpendingMinor)).toBeGreaterThanOrEqual(used);
  });

  it("allows an explicit zero planned amount when editing the budget", async () => {
    const budget = (await db.$transaction((tx) => getBudgetByMonth(tx, "2026-10")))!;
    const lines = (await fullBudgetLines(db, { groceries: 0n })).map((l) => ({ ...l }));
    const updated = await db.$transaction((tx) => updateBudget(tx, budget.id, budget.version, { lines }, ctx));
    const groceries = updated.details.find((d) => d.subcategoryId === "groceries")!;
    expect(groceries.budgetAmountMinor).toBe("0");
    expect(groceries.spendMinor).toBe("150000");
    expect(groceries.utilizationBps).toBeNull();
    expect(updated.totals.totalProvisionedMinor).toBe("0");
  });
});
