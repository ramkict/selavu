import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/server/db";
import { createAccount, deleteAccount, listAccounts, updateAccount } from "@/server/domain/accounts";
import { updateTransaction, deleteTransaction } from "@/server/domain/transactions";
import { freshDb, ctx } from "./helpers";
import { addTransaction, balanceOf, expenseInput, openAccount } from "./fixtures";

describe("accounts", () => {
  let db: Db;
  beforeAll(async () => {
    db = await freshDb();
  });

  it("persists a same-class type edit and returns the saved value after reload", async () => {
    const created = await openAccount(db, "HDFC Savings", "SAVINGS", "100000");
    const updated = await db.$transaction((tx) => updateAccount(tx, created.id, created.version, { accountType: "FD" }, ctx));
    expect(updated.accountType).toBe("FD");
    expect((await db.accountMaster.findUniqueOrThrow({ where: { id: created.id } })).accountType).toBe("FD");
  });

  it("rejects an asset-to-liability type change once the account has transactions", async () => {
    const deposit = await openAccount(db, "Fixed Deposit", "FD", "0");
    const savings = await openAccount(db, "Bank Savings", "SAVINGS", "50000");
    await addTransaction(db, {
      type: "FINANCIAL",
      financialKind: "TRANSFER",
      date: "2026-10-02",
      description: "Open FD",
      amountMinor: 10000n,
      sourceAccountId: savings.id,
      destinationAccountId: deposit.id,
      categoryId: "sys_accounts",
      subcategoryId: "sys_transfer",
    });
    await expect(db.$transaction((tx) => updateAccount(tx, deposit.id, deposit.version, { accountType: "LOAN" }, ctx))).rejects.toMatchObject({
      status: 422,
    });
    expect((await db.accountMaster.findUniqueOrThrow({ where: { id: deposit.id } })).accountType).toBe("FD");
  });

  it("refuses to edit protected accounts, including Cash In Hand", async () => {
    await expect(db.$transaction((tx) => updateAccount(tx, "sys_expense", 1, { name: "Spend" }, ctx))).rejects.toMatchObject({ status: 422 });
    await expect(db.$transaction((tx) => updateAccount(tx, "sys_cash_in_hand", 1, { name: "Pocket" }, ctx))).rejects.toMatchObject({ status: 422 });
  });

  it("does not offer Cash In Hand as a user-created account type", async () => {
    await expect(
      db.$transaction((tx) => createAccount(tx, { name: "My Cash", accountType: "CASH", openingBalanceMinor: "0", openingDate: "2026-10-01" }, ctx)),
    ).rejects.toMatchObject({ status: 422, fieldErrors: { accountType: expect.any(Array) } });
  });

  it("edits starting figures before activity and rebuilds persisted snapshots", async () => {
    const account = await openAccount(db, "Editable Bank", "SAVINGS", "10000");
    const updated = await db.$transaction((tx) => updateAccount(tx, account.id, account.version, { name: "Renamed Bank", openingBalanceMinor: "25050", openingDate: "2026-09-01" }, ctx));
    expect(updated).toMatchObject({ name: "Renamed Bank", startingBalanceMinor: "25050", currentBalanceMinor: "25050", openingDate: "2026-09-01", version: 2 });
    const snapshot = await db.runningAccount.findUniqueOrThrow({ where: { accountId_month: { accountId: account.id, month: "2026-09" } } });
    expect(snapshot.closingBalanceMinor).toBe(25050n);
    await expect(db.$transaction((tx) => updateAccount(tx, account.id, 1, { name: "Stale" }, ctx))).rejects.toMatchObject({ status: 409 });
    await addTransaction(db, expenseInput({ sourceAccountId: account.id, amountMinor: 100n }));
    await expect(db.$transaction((tx) => updateAccount(tx, account.id, 2, { openingBalanceMinor: "50000" }, ctx))).rejects.toMatchObject({ status: 422 });
    expect(await balanceOf(db, account.id)).toBe(24950n);
  });

  it("deletes unused accounts and snapshots with version checks and an audit record", async () => {
    const account = await openAccount(db, "Unused Bank", "SAVINGS", "10000");
    await expect(db.$transaction((tx) => deleteAccount(tx, account.id, 99, ctx))).rejects.toMatchObject({ status: 409 });
    await db.$transaction((tx) => deleteAccount(tx, account.id, account.version, ctx));
    expect(await db.accountMaster.findUnique({ where: { id: account.id } })).toBeNull();
    expect(await db.runningAccount.count({ where: { accountId: account.id } })).toBe(0);
    expect(await db.auditEvent.count({ where: { entityId: account.id, action: "DELETE" } })).toBe(1);
  });

  it("protects system accounts and accounts with transaction history from deletion", async () => {
    for (const id of ["sys_cash_in_hand", "sys_expense", "sys_income"]) {
      await expect(db.$transaction((tx) => deleteAccount(tx, id, 1, ctx))).rejects.toMatchObject({ status: 422 });
    }
    const bank = await openAccount(db, "Used Bank", "SAVINGS", "10000");
    await addTransaction(db, expenseInput({ sourceAccountId: bank.id, amountMinor: 100n }));
    await expect(db.$transaction((tx) => deleteAccount(tx, bank.id, bank.version, ctx))).rejects.toMatchObject({ status: 409 });
    expect(await balanceOf(db, bank.id)).toBe(9900n);
  });

  it("archives and restores an account without changing history or balances", async () => {
    const bank = await openAccount(db, "Archived Bank", "SAVINGS", "10000");
    await addTransaction(db, expenseInput({ sourceAccountId: bank.id, amountMinor: 1200n }));
    const archived = await db.$transaction((tx) => updateAccount(tx, bank.id, bank.version, { archived: true }, ctx));
    expect(archived.archivedAt).not.toBeNull();
    expect(await balanceOf(db, bank.id)).toBe(8800n);
    await expect(addTransaction(db, expenseInput({ sourceAccountId: bank.id, amountMinor: 100n }))).rejects.toMatchObject({ status: 422 });

    const restored = await db.$transaction((tx) => updateAccount(tx, bank.id, archived.version, { archived: false }, ctx));
    expect(restored.archivedAt).toBeNull();
    await addTransaction(db, expenseInput({ sourceAccountId: bank.id, amountMinor: 100n }));
    expect(await balanceOf(db, bank.id)).toBe(8700n);
  });

  it("rejects duplicate names using Unicode-normalized comparison", async () => {
    await openAccount(db, "ＳＢＩ Ｓａｖｉｎｇｓ", "SAVINGS");
    await expect(
      db.$transaction((tx) => createAccount(tx, { name: "sbi   savings", accountType: "SAVINGS", openingBalanceMinor: "0", openingDate: "2026-10-01" }, ctx)),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("rejects a future opening date and keeps a liability opening as signed debt", async () => {
    await expect(openAccount(db, "Future Bank", "SAVINGS", "0", "2026-11-01")).rejects.toMatchObject({ status: 422 });
    const card = await openAccount(db, "Visa Card", "CREDIT_CARD", "-250000");
    expect(card.currentBalanceMinor).toBe("-250000");
    expect(card.balanceNote).toBe("Credit available");
  });

  it("maintains starting, monthly opening/closing and current balances in the monthly snapshot table", async () => {
    const acc = await openAccount(db, "Snapshot Savings", "SAVINGS", "10000000", "2026-08-01");
    await addTransaction(db, expenseInput({ sourceAccountId: acc.id, amountMinor: 1000000n, date: "2026-09-10" }));
    await addTransaction(db, expenseInput({ sourceAccountId: acc.id, amountMinor: 500000n, date: "2026-10-05" }));

    const oct = (await db.$transaction((tx) => listAccounts(tx, "2026-10"))).find((a) => a.id === acc.id)!;
    expect(oct).toMatchObject({
      startingBalanceMinor: "10000000",
      monthOpeningMinor: "9000000",
      monthClosingMinor: "8500000",
      currentBalanceMinor: "8500000",
      monthOpeningFormatted: "₹90,000.00",
      monthClosingFormatted: "₹85,000.00",
      currentBalanceFormatted: "₹85,000.00",
    });

    const sep = (await db.$transaction((tx) => listAccounts(tx, "2026-09"))).find((a) => a.id === acc.id)!;
    expect(sep).toMatchObject({ monthOpeningMinor: "10000000", monthClosingMinor: "9000000", currentBalanceMinor: "8500000" });

    const jul = (await db.$transaction((tx) => listAccounts(tx, "2026-07"))).find((a) => a.id === acc.id)!;
    expect(jul).toMatchObject({ monthStatus: "NOT_OPENED", monthOpeningMinor: null, monthClosingMinor: null });

    const rows = await db.runningAccount.findMany({ where: { accountId: acc.id }, orderBy: { month: "asc" } });
    expect(rows.map((r) => r.month)).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(rows.at(-1)!.closingBalanceMinor).toBe(8500000n);
  });

  it("persists Expenses monthly totals separately from assets and keeps withdrawals out of expenses", async () => {
    const db = await freshDb();
    const bank = await openAccount(db, "Expense Snapshot Bank", "SAVINGS", "100000", "2026-08-01");
    const before = await balanceOf(db, "sys_expense");
    const input = expenseInput({ sourceAccountId: bank.id, amountMinor: 12550n, date: "2026-09-10" });
    const expense = await addTransaction(db, input);
    await addTransaction(db, { type: "FINANCIAL", financialKind: "ATM_WITHDRAWAL", date: "2026-10-01", description: "ATM", amountMinor: 20000n, sourceAccountId: bank.id, destinationAccountId: "sys_cash_in_hand", categoryId: "sys_accounts", subcategoryId: "sys_transfer" });
    const expenses = (await db.$transaction((tx) => listAccounts(tx, "2026-10"))).find((a) => a.id === "sys_expense")!;
    expect(expenses).toMatchObject({ kind: "EXTERNAL", isProtected: true, monthOpeningMinor: (before + 12550n).toString(), monthClosingMinor: (before + 12550n).toString(), currentBalanceMinor: (before + 12550n).toString() });
    const snapshot = await db.runningAccount.findUniqueOrThrow({ where: { accountId_month: { accountId: "sys_expense", month: "2026-10" } } });
    expect(snapshot.closingBalanceMinor).toBe(before + 12550n);
    const updated = await db.$transaction((tx) => updateTransaction(tx, expense.id, expense.version, { ...input, amountMinor: 5000n, date: "2026-10-05" }, ctx));
    const september = await db.runningAccount.findUniqueOrThrow({ where: { accountId_month: { accountId: "sys_expense", month: "2026-09" } } });
    expect(september.closingBalanceMinor).toBe(0n);
    expect(await balanceOf(db, "sys_expense")).toBe(5000n);
    await db.$transaction((tx) => deleteTransaction(tx, updated.id, updated.version, ctx));
    const october = await db.runningAccount.findUniqueOrThrow({ where: { accountId_month: { accountId: "sys_expense", month: "2026-10" } } });
    expect(october.closingBalanceMinor).toBe(0n);
    expect(await balanceOf(db, "sys_expense")).toBe(0n);
    await db.$disconnect();
  });

  it("Cash In Hand is always present as an owned asset with monthly snapshots from its opening date", async () => {
    const cash = (await db.$transaction((tx) => listAccounts(tx, "2026-10"))).find((a) => a.id === "sys_cash_in_hand")!;
    expect(cash).toMatchObject({ accountType: "CASH", kind: "ASSET", isProtected: true, accountTypeLabel: "Generic account" });
    expect(await balanceOf(db, "sys_cash_in_hand")).toBe(0n);
  });
});
