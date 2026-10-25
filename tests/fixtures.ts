import type { Db } from "@/server/db";
import { createAccount } from "@/server/domain/accounts";
import { createTransaction, type TransactionDraft } from "@/server/domain/transactions";
import { createBudget, type BudgetLineInput } from "@/server/domain/budgets";
import { CARD_SETTLEMENT_CATEGORY, defaultPlanningClass } from "@/server/catalog/catalog";
import { ctx } from "./helpers";

export async function openAccount(db: Db, name: string, accountType: string, openingBalanceMinor = "0", openingDate = "2026-10-01") {
  return db.$transaction((tx) => createAccount(tx, { name, accountType, openingBalanceMinor, openingDate }, ctx));
}

export function expenseInput(overrides: Partial<TransactionDraft> & { sourceAccountId: string; amountMinor: bigint }) {
  return {
    type: "EXPENSE" as const,
    date: "2026-10-05",
    description: "Weekly groceries",
    paymentModeId: "upi",
    expenseLocation: "CHE" as const,
    categoryId: "groceries_everyday",
    subcategoryId: "provisions",
    destinationAccountId: "sys_expense",
    ...overrides,
  };
}

export async function addTransaction(db: Db, input: Parameters<typeof createTransaction>[1]) {
  return db.$transaction((tx) => createTransaction(tx, input, ctx));
}

/** One line for every active non-system subcategory; `amounts` overrides the default zero plan (keys are subcategory IDs). */
export async function fullBudgetLines(db: Db, amounts: Record<string, bigint> = {}): Promise<BudgetLineInput[]> {
  const subs = (await db.subcategory.findMany({
    where: { archivedAt: null, parent: { archivedAt: null } },
    select: { id: true, parentCategoryId: true, isSystem: true, parent: { select: { isSystem: true } } },
    orderBy: [{ parentCategoryId: "asc" }, { id: "asc" }],
  })).filter((subcategory) => (!subcategory.isSystem && !subcategory.parent.isSystem) || subcategory.parentCategoryId === CARD_SETTLEMENT_CATEGORY.id);
  return subs.map((s) => ({
    categoryId: s.parentCategoryId,
    subcategoryId: s.id,
    planningClass: defaultPlanningClass(s.parentCategoryId, s.id),
    budgetAmountMinor: amounts[s.id] ?? 0n,
    alertThresholdBps: 8000,
  }));
}

export async function addBudget(db: Db, month: string, amounts: Record<string, bigint>) {
  const lines = await fullBudgetLines(db, amounts);
  return db.$transaction((tx) => createBudget(tx, { month, lines }, ctx));
}

export async function balanceOf(db: Db, id: string) {
  return (await db.accountMaster.findUniqueOrThrow({ where: { id }, select: { currentBalanceMinor: true } })).currentBalanceMinor;
}
