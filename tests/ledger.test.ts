import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/server/db";
import { createTransaction, deleteTransaction, listTransactions, updateTransaction } from "@/server/domain/transactions";
import { listAccountMonths } from "@/server/domain/accounts";
import { getDashboard } from "@/server/domain/dashboard";
import { freshDb, ctx } from "./helpers";
import { addTransaction, balanceOf, expenseInput, openAccount } from "./fixtures";

describe("ledger: postings, signs, and projections", () => {
  let db: Db;
  let savings: { id: string; version: number };
  let cash: { id: string };
  let card: { id: string };

  beforeAll(async () => {
    db = await freshDb();
    savings = await openAccount(db, "Main Savings", "SAVINGS", "5000000", "2026-10-01");
    cash = { id: "sys_cash_in_hand" };
    card = await openAccount(db, "Visa", "CREDIT_CARD", "0", "2026-10-01");
  });

  it("posts an expense once, debits the source, and tags the actual location", async () => {
    const t = await addTransaction(db, expenseInput({ sourceAccountId: savings.id, amountMinor: 12550n }));
    expect(t.expenseLocation).toBe("CHE");
    expect(t.budgetMatch).toBe("UNBUDGETED");
    expect(await balanceOf(db, savings.id)).toBe(5000000n - 12550n);
    const postings = await db.transactionPosting.findMany({ where: { transactionId: t.id }, orderBy: { accountId: "asc" } });
    expect(postings.map((p) => p.deltaMinor).sort()).toEqual([-12550n, 12550n].sort());
    expect(await balanceOf(db, "sys_expense")).toBe(12550n);
  });

  it("defaults an omitted expense location to CHE and rejects location on non-expenses", async () => {
    const t = await addTransaction(db, expenseInput({ sourceAccountId: savings.id, amountMinor: 100n, expenseLocation: null }));
    expect(t.expenseLocation).toBe("CHE");
    await expect(
      addTransaction(db, {
        type: "FINANCIAL",
        financialKind: "ATM_WITHDRAWAL",
        date: "2026-10-03",
        description: "ATM",
        amountMinor: 100n,
        sourceAccountId: savings.id,
        destinationAccountId: cash.id,
        categoryId: "sys_accounts",
        subcategoryId: "sys_transfer",
        expenseLocation: "CHE",
      }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("rejects actual transactions dated in the future", async () => {
    await expect(addTransaction(db, expenseInput({ sourceAccountId: savings.id, amountMinor: 100n, date: "2026-10-23" }))).rejects.toMatchObject({
      status: 422,
      fieldErrors: { date: expect.any(Array) },
    });
  });

  it("ATM withdrawal moves Savings to Cash without touching expenses", async () => {
    const before = await balanceOf(db, "sys_expense");
    await addTransaction(db, {
      type: "FINANCIAL",
      financialKind: "ATM_WITHDRAWAL",
      date: "2026-10-04",
      description: "ATM withdrawal",
      amountMinor: 200000n,
      sourceAccountId: savings.id,
      destinationAccountId: cash.id,
      categoryId: "sys_accounts",
      subcategoryId: "sys_transfer",
    });
    expect(await balanceOf(db, cash.id)).toBe(200000n);
    expect(await balanceOf(db, "sys_expense")).toBe(before);
  });

  it("credit purchase raises debt once; card payment lowers debt without a second expense", async () => {
    const expenseBefore = await balanceOf(db, "sys_expense");
    await addTransaction(db, expenseInput({ sourceAccountId: card.id, amountMinor: 200000n, date: "2026-10-06", description: "Electronics" }));
    expect(await balanceOf(db, card.id)).toBe(200000n);
    expect(await balanceOf(db, "sys_expense")).toBe(expenseBefore + 200000n);

    const expenseAfterPurchase = await balanceOf(db, "sys_expense");
    await addTransaction(db, {
      type: "FINANCIAL",
      financialKind: "CARD_PAYMENT",
      date: "2026-10-07",
      description: "Card bill",
      amountMinor: 200000n,
      sourceAccountId: savings.id,
      destinationAccountId: card.id,
      categoryId: "sys_card_settlement",
      subcategoryId: "credit_card_1",
    });
    expect(await balanceOf(db, card.id)).toBe(0n);
    expect(await balanceOf(db, "sys_expense")).toBe(expenseAfterPurchase);
  });

  it("income posts once into Savings from the protected Income account", async () => {
    const before = await balanceOf(db, savings.id);
    await addTransaction(db, {
      type: "FINANCIAL",
      financialKind: "INCOME",
      date: "2026-10-01",
      description: "Monthly salary",
      amountMinor: 10000000n,
      sourceAccountId: "sys_income",
      destinationAccountId: savings.id,
      categoryId: "sys_accounts",
      subcategoryId: "sys_transfer",
      incomeType: "SALARY",
      incomeSourceLabel: "Employer",
      recurring: true,
    });
    expect(await balanceOf(db, savings.id)).toBe(before + 10000000n);
    expect(await balanceOf(db, "sys_income")).toBe(-10000000n);
  });

  it("income cannot be classified under an ordinary spending subcategory", async () => {
    await expect(
      addTransaction(db, {
        type: "FINANCIAL",
        financialKind: "INCOME",
        date: "2026-10-01",
        description: "Gift",
        amountMinor: 100n,
        sourceAccountId: "sys_income",
        destinationAccountId: cash.id,
        categoryId: "food",
        subcategoryId: "provisions",
      }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("rejects dates before an owned account opened", async () => {
    const late = await openAccount(db, "Late Bank", "SAVINGS", "0", "2026-10-15");
    await expect(addTransaction(db, expenseInput({ sourceAccountId: late.id, amountMinor: 100n, date: "2026-10-10" }))).rejects.toMatchObject({
      status: 422,
    });
  });

  it("location-only edit changes report grouping but not balances or postings", async () => {
    const t = await addTransaction(db, expenseInput({ sourceAccountId: cash.id, amountMinor: 3000n, date: "2026-10-08", expenseLocation: "CHE" }));
    const postingsBefore = await db.transactionPosting.findMany({ where: { transactionId: t.id }, orderBy: { accountId: "asc" }, select: { accountId: true, deltaMinor: true } });
    const balanceBefore = await balanceOf(db, cash.id);
    const updated = await db.$transaction((tx) =>
      updateTransaction(
        tx,
        t.id,
        t.version,
        { ...toInput(t), expenseLocation: "HYD" },
        ctx,
      ),
    );
    expect(updated.expenseLocation).toBe("HYD");
    expect(updated.version).toBe(t.version + 1);
    expect(await balanceOf(db, cash.id)).toBe(balanceBefore);
    const postingsAfter = await db.transactionPosting.findMany({ where: { transactionId: t.id }, orderBy: { accountId: "asc" }, select: { accountId: true, deltaMinor: true } });
    expect(postingsAfter).toEqual(postingsBefore);
  });

  it("rejects an update with a stale version and leaves facts unchanged", async () => {
    const t = await addTransaction(db, expenseInput({ sourceAccountId: cash.id, amountMinor: 700n, date: "2026-10-09" }));
    await db.$transaction((tx) => updateTransaction(tx, t.id, t.version, { ...toInput(t), amountMinor: 800n }, ctx));
    await expect(db.$transaction((tx) => updateTransaction(tx, t.id, t.version, { ...toInput(t), amountMinor: 900n }, ctx))).rejects.toMatchObject({
      status: 409,
    });
    expect((await db.transaction.findUniqueOrThrow({ where: { id: t.id } })).amountMinor).toBe(800n);
  });

  it("backdating across months moves the amount between monthly running rows", async () => {
    const old = await openAccount(db, "Old Wallet", "SAVINGS", "100000", "2026-08-01");
    const t = await addTransaction(db, expenseInput({ sourceAccountId: old.id, amountMinor: 5000n, date: "2026-10-10" }));
    await db.$transaction((tx) => updateTransaction(tx, t.id, t.version, { ...toInput(t), date: "2026-09-20" }, ctx));
    const months = await db.$transaction((tx) => listAccountMonths(tx, old.id));
    const byMonth = Object.fromEntries(months.map((m) => [m.month, m]));
    expect(Object.keys(byMonth).sort()).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(byMonth["2026-09"].movementMinor).toBe("-5000");
    expect(byMonth["2026-10"].movementMinor).toBe("0");
    expect(byMonth["2026-10"].openingBalanceMinor).toBe("95000");
    expect(await balanceOf(db, old.id)).toBe(95000n);
  });

  it("delete reverses postings and balances", async () => {
    const before = await balanceOf(db, cash.id);
    const t = await addTransaction(db, expenseInput({ sourceAccountId: cash.id, amountMinor: 4000n, date: "2026-10-11" }));
    expect(await balanceOf(db, cash.id)).toBe(before - 4000n);
    await db.$transaction((tx) => deleteTransaction(tx, t.id, t.version, ctx));
    expect(await balanceOf(db, cash.id)).toBe(before);
    expect(await db.transactionPosting.count({ where: { transactionId: t.id } })).toBe(0);
  });

  it("filters and sorts transactions by account and description", async () => {
    const match = await addTransaction(db, expenseInput({ sourceAccountId: savings.id, amountMinor: 4500n, description: "Needle groceries", date: "2026-10-14" }));
    await addTransaction(db, expenseInput({ sourceAccountId: cash.id, amountMinor: 2500n, description: "Market groceries", date: "2026-10-15" }));
    const result = await db.$transaction((tx) => listTransactions(tx, { month: "2026-10", accountId: savings.id, search: "needle", sort: "amount-asc" }));
    expect(result.total).toBe(1);
    expect(result.items[0].id).toBe(match.id);
  });

  it("a failed command rolls back every effect, including balances and revisions", async () => {
    const before = await balanceOf(db, cash.id);
    const count = await db.transaction.count();
    await expect(
      db.$transaction(async (tx) => {
        await tx.transaction.count();
        await createTransaction(tx, expenseInput({ sourceAccountId: cash.id, amountMinor: 999n, date: "2026-10-12" }), ctx);
        throw new Error("simulated failure after writes");
      }),
    ).rejects.toThrow("simulated failure");
    expect(await balanceOf(db, cash.id)).toBe(before);
    expect(await db.transaction.count()).toBe(count);
  });

  it("dashboard location buckets reconcile to total expenses and net worth counts liabilities once", async () => {
    const dash = await getDashboard(db, "2026-10", new Date("2026-10-22T06:00:00Z"));
    const byLocation = dash.expensesByLocation.reduce((sum, row) => sum + BigInt(row.minor), 0n);
    expect(byLocation.toString()).toBe(dash.metrics.expenses.minor);
    const expected = BigInt(dash.netWorth.assetsMinor) - BigInt(dash.netWorth.liabilitiesMinor);
    expect(dash.netWorth.netWorthMinor).toBe(expected.toString());
    expect(dash.metrics.totalIncome.minor).toBe("10000000");
  });
});

// Re-submits an existing transaction's facts as the editable draft shape.
function toInput(t: {
  type: string;
  financialKind: string | null;
  date: string;
  description: string;
  notes: string | null;
  amountMinor: string;
  source: { id: string };
  destination: { id: string };
  paymentMode: { id: string } | null;
  expenseLocation: string | null;
  categoryId: string;
  subcategory: { id: string };
  incomeType: string | null;
  incomeSourceLabel: string | null;
  recurring: boolean;
}) {
  return {
    type: t.type as "EXPENSE" | "FINANCIAL",
    financialKind: (t.financialKind ?? null) as never,
    date: t.date,
    description: t.description,
    notes: t.notes,
    amountMinor: BigInt(t.amountMinor),
    sourceAccountId: t.source.id,
    destinationAccountId: t.destination.id,
    paymentModeId: t.paymentMode?.id ?? null,
    expenseLocation: (t.expenseLocation ?? null) as never,
    categoryId: t.categoryId,
    subcategoryId: t.subcategory.id,
    incomeType: t.incomeType,
    incomeSourceLabel: t.incomeSourceLabel,
    recurring: t.recurring,
  };
}
