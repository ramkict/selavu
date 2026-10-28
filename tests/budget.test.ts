import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/server/db";
import { createBudget, deleteBudget, getBudgetByMonth, updateBudget } from "@/server/domain/budgets";
import { deleteTransaction, updateTransaction } from "@/server/domain/transactions";
import { getDashboard } from "@/server/domain/dashboard";
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

    const budget = await addBudget(db, "2026-10", { provisions: 200000n });
    expect(budget.details.find((d) => d.subcategoryId === "provisions")).toMatchObject({
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
    await addTransaction(db, expenseInput({ sourceAccountId: savings.id, amountMinor: 30000n, date: "2026-10-12", categoryId: "food", subcategoryId: "dine_out" }));
    const master = await db.$transaction((tx) => getBudgetByMonth(tx, "2026-10"));
    const dining = master!.details.find((d) => d.subcategoryId === "dine_out")!;
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

    const recreated = await addBudget(db, "2026-10", { provisions: 150000n });
    expect(recreated.details.find((d) => d.subcategoryId === "provisions")!.spendMinor).toBe("150000");
  });

  it("updates planned amounts with version checks and recalculates remaining provision", async () => {
    const budget = (await db.$transaction((tx) => getBudgetByMonth(tx, "2026-10")))!;
    const lines = (await fullBudgetLines(db, { provisions: 300000n })).map((l) => ({ ...l }));
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
          categoryId: "groceries_everyday",
          subcategoryId: "provisions",
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
    const lines = (await fullBudgetLines(db, { provisions: 0n })).map((l) => ({ ...l }));
    const updated = await db.$transaction((tx) => updateBudget(tx, budget.id, budget.version, { lines }, ctx));
    const provisions = updated.details.find((d) => d.subcategoryId === "provisions")!;
    expect(provisions.budgetAmountMinor).toBe("0");
    expect(provisions.spendMinor).toBe("150000");
    expect(provisions.utilizationBps).toBeNull();
    expect(updated.totals.totalProvisionedMinor).toBe("0");
  });

  it("provisions savings and compares all plans with income without treating transfers as spending", async () => {
    const isolated = await freshDb();
    const bank = await openAccount(isolated, "Salary bank", "SAVINGS");
    const fund = await openAccount(isolated, "SIP", "MUTUAL_FUND");
    await addBudget(isolated, "2026-10", { mutual_funds: 500000n, kids_savings: 200000n, fixed_deposits: 300000n, provisions: 100000n, credit_card_1: 50000n });
    await addTransaction(isolated, { type: "FINANCIAL", financialKind: "INCOME", date: "2026-10-05", description: "Salary", amountMinor: 1200000n, sourceAccountId: "sys_income", destinationAccountId: bank.id, categoryId: "sys_accounts", subcategoryId: "sys_transfer" });
    const contribution = await addTransaction(isolated, { type: "FINANCIAL", financialKind: "TRANSFER", date: "2026-10-06", description: "SIP contribution", amountMinor: 300000n, sourceAccountId: bank.id, destinationAccountId: fund.id, categoryId: "savings_investments", subcategoryId: "mutual_funds" });
    expect(contribution.budgetMatch).toBe("MATCHED");
    const budget = (await isolated.$transaction((tx) => getBudgetByMonth(tx, "2026-10")))!;
    expect(budget.totals).toMatchObject({ incomeReceivedMinor: "1200000", allProvisionedMinor: "1150000", incomeBalanceMinor: "50000", savingsPlannedMinor: "1000000", savingsUsedMinor: "300000", currentSpendingMinor: "0" });
    const updatedContribution = await isolated.$transaction((tx) => updateTransaction(tx, contribution.id, contribution.version, { type: "FINANCIAL", financialKind: "TRANSFER", date: "2026-10-06", description: "Adjusted SIP", amountMinor: 200000n, sourceAccountId: bank.id, destinationAccountId: fund.id, categoryId: "savings_investments", subcategoryId: "mutual_funds" }, ctx));
    expect((await isolated.$transaction((tx) => getBudgetByMonth(tx, "2026-10")))!.totals.savingsUsedMinor).toBe("200000");
    await isolated.$transaction((tx) => deleteTransaction(tx, updatedContribution.id, updatedContribution.version, ctx));
    expect((await isolated.$transaction((tx) => getBudgetByMonth(tx, "2026-10")))!.totals.savingsUsedMinor).toBe("0");
    expect(await balanceOf(isolated, fund.id)).toBe(0n);
    await addTransaction(isolated, { type: "FINANCIAL", financialKind: "TRANSFER", date: "2026-10-06", description: "General transfer", amountMinor: 10000n, sourceAccountId: bank.id, destinationAccountId: fund.id, categoryId: "sys_accounts", subcategoryId: "sys_transfer" });
    expect((await isolated.$transaction((tx) => getBudgetByMonth(tx, "2026-10")))!.totals.savingsUsedMinor).toBe("0");
    const lines = await fullBudgetLines(isolated, { mutual_funds: 1500000n });
    const deficit = await isolated.$transaction((tx) => updateBudget(tx, budget.id, budget.version, { lines }, ctx));
    expect(deficit.totals.incomeBalanceMinor).toBe("-300000");
    await isolated.subcategory.create({ data: { id: "late_expense", parentCategoryId: "food", name: "Late expense", normalizedName: "late expense" } });
    await addTransaction(isolated, expenseInput({ sourceAccountId: bank.id, amountMinor: 100n, categoryId: "food", subcategoryId: "late_expense" }));
    const dashboard = await isolated.$transaction((tx) => getDashboard(tx, "2026-10"));
    expect(dashboard.alerts.some((alert) => alert.message === "Some expenses are unbudgeted in this month.")).toBe(true);
    await expect(addTransaction(isolated, expenseInput({ sourceAccountId: bank.id, amountMinor: 100n, categoryId: "savings_investments", subcategoryId: "mutual_funds" }))).rejects.toMatchObject({ status: 422 });
    await isolated.$disconnect();
  });

  it("accrues loan interest without using cash and budgets repayments only once", async () => {
    const isolated = await freshDb();
    const bank = await openAccount(isolated, "Loan bank", "SAVINGS", "1000000");
    const loan = await openAccount(isolated, "Home Loan", "LOAN", "10000000");
    await addBudget(isolated, "2026-10", { home_loan_emi: 500000n });
    const accrual = await addTransaction(isolated, { type: "FINANCIAL", financialKind: "INTEREST_ACCRUAL", date: "2026-10-05", description: "Monthly interest", amountMinor: 100000n, sourceAccountId: loan.id, destinationAccountId: "sys_expense", categoryId: "sys_accounts", subcategoryId: "sys_transfer" });
    expect(accrual.budgetMatch).toBe("NOT_APPLICABLE");
    expect(await balanceOf(isolated, loan.id)).toBe(10100000n);
    expect(await balanceOf(isolated, bank.id)).toBe(1000000n);
    const repayment = await addTransaction(isolated, { type: "FINANCIAL", financialKind: "LOAN_PAYMENT", date: "2026-10-06", description: "Home loan instalment", amountMinor: 500000n, sourceAccountId: bank.id, destinationAccountId: loan.id, categoryId: "housing", subcategoryId: "home_loan_emi" });
    expect(repayment.budgetMatch).toBe("MATCHED");
    expect(await balanceOf(isolated, loan.id)).toBe(9600000n);
    expect(await balanceOf(isolated, bank.id)).toBe(500000n);
    const budget = (await isolated.$transaction((tx) => getBudgetByMonth(tx, "2026-10")))!;
    expect(budget.totals.budgetUsedMinor).toBe("500000");
    expect(budget.totals.currentSpendingMinor).toBe("0");
    await isolated.$transaction((tx) => deleteTransaction(tx, accrual.id, accrual.version, ctx));
    expect(await balanceOf(isolated, loan.id)).toBe(9500000n);
    expect(await balanceOf(isolated, bank.id)).toBe(500000n);
    await isolated.$transaction((tx) => deleteTransaction(tx, repayment.id, repayment.version, ctx));
    expect(await balanceOf(isolated, loan.id)).toBe(10000000n);
    expect(await balanceOf(isolated, bank.id)).toBe(1000000n);
    expect((await isolated.$transaction((tx) => getBudgetByMonth(tx, "2026-10")))!.totals.budgetUsedMinor).toBe("0");
    await expect(addTransaction(isolated, { type: "FINANCIAL", financialKind: "INTEREST_ACCRUAL", date: "2026-10-05", description: "Invalid interest", amountMinor: 100n, sourceAccountId: bank.id, destinationAccountId: "sys_expense", categoryId: "sys_accounts", subcategoryId: "sys_transfer" })).rejects.toMatchObject({ status: 422 });
    await isolated.$disconnect();
  });
});
