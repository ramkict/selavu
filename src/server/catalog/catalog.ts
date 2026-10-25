import catalogJson from "./household.json";
import type { PrismaClient } from "@/generated/prisma/client";
import { normalizeName } from "../lib/text";
import { todayIn } from "../lib/calendar";
import { refreshAccounts } from "../domain/projections";
import { CARD_SETTLEMENT_CATEGORY_ID } from "../domain/rules";

export type PlanningClass = "EXPENSE" | "CARD_SETTLEMENT";

type CatalogSub = { id: string; name: string };
type CatalogCategory = { id: string; name: string; icon: string; color: string; subCategories: CatalogSub[] };

export const CATALOG = catalogJson as CatalogCategory[];

export const SYSTEM_CATEGORY = { id: "sys_accounts", name: "Accounts", icon: "account_balance", color: "#64748b" };
export const SYSTEM_SUBCATEGORY = { id: "sys_transfer", name: "Transfer", parentCategoryId: SYSTEM_CATEGORY.id };
export const CARD_SETTLEMENT_CATEGORY = { id: CARD_SETTLEMENT_CATEGORY_ID, name: "Card Settlement", icon: "credit-card", color: "#3e9bad" };
export const CARD_SETTLEMENT_SUBCATEGORIES = [
  { id: "credit_card_1", parentCategoryId: CARD_SETTLEMENT_CATEGORY.id, name: "Credit Card 1" },
  { id: "credit_card_2", parentCategoryId: CARD_SETTLEMENT_CATEGORY.id, name: "Credit Card 2" },
  { id: "credit_card_3", parentCategoryId: CARD_SETTLEMENT_CATEGORY.id, name: "Credit Card 3" },
];

export const PAYMENT_MODES = [
  { id: "cash", name: "Cash" },
  { id: "upi", name: "UPI" },
  { id: "debit_card", name: "Debit Card" },
  { id: "credit_card", name: "Credit Card" },
  { id: "net_banking", name: "Net Banking" },
  { id: "bank_transfer", name: "Bank Transfer" },
  { id: "cheque", name: "Cheque" },
  { id: "other", name: "Other" },
];

/**
 * Always-present generic accounts. Cash In Hand is an owned asset (not user-selectable as a type);
 * Income and Expense are external endpoints excluded from owned balances and net worth.
 */
export const SYSTEM_ACCOUNTS = [
  { id: "sys_cash_in_hand", name: "Cash In Hand", accountType: "CASH", openingDate: "2026-01-01" },
  { id: "sys_income", name: "Income", accountType: "EXTERNAL_INCOME", openingDate: "1900-01-01" },
  { id: "sys_expense", name: "Expenses", accountType: "EXTERNAL_EXPENSE", openingDate: "1900-01-01" },
];

/**
 * Card repayments remain a separate planning lane; every other subcategory is regular spending.
 */
export function defaultPlanningClass(categoryId: string, subcategoryId: string): PlanningClass {
  if (categoryId === CARD_SETTLEMENT_CATEGORY.id && subcategoryId.startsWith("credit_card_")) return "CARD_SETTLEMENT";
  return "EXPENSE";
}

/**
 * Inserts only missing catalog and system records. Existing rows (including user
 * edits, names, archive state) are never overwritten.
 */
export async function seedCatalog(prisma: PrismaClient): Promise<{ insertedCategories: number; insertedSubcategories: number }> {
  let insertedCategories = 0;
  let insertedSubcategories = 0;
  const now = new Date();

  const categoryRows = [
    ...CATALOG.map((c) => ({ id: c.id, name: c.name, icon: c.icon, color: c.color, isSystem: false })),
    { id: SYSTEM_CATEGORY.id, name: SYSTEM_CATEGORY.name, icon: SYSTEM_CATEGORY.icon, color: SYSTEM_CATEGORY.color, isSystem: true },
    { id: CARD_SETTLEMENT_CATEGORY.id, name: CARD_SETTLEMENT_CATEGORY.name, icon: CARD_SETTLEMENT_CATEGORY.icon, color: CARD_SETTLEMENT_CATEGORY.color, isSystem: true },
  ];
  for (const row of categoryRows) {
    const exists = await prisma.category.findUnique({ where: { id: row.id }, select: { id: true } });
    if (exists) continue;
    await prisma.category.create({ data: { ...row, normalizedName: normalizeName(row.name), updatedAt: now } });
    insertedCategories++;
  }

  const subRows = [
    ...CATALOG.flatMap((c) => c.subCategories.map((s) => ({ id: s.id, parentCategoryId: c.id, name: s.name, isSystem: false }))),
    { id: SYSTEM_SUBCATEGORY.id, parentCategoryId: SYSTEM_CATEGORY.id, name: SYSTEM_SUBCATEGORY.name, isSystem: true },
    ...CARD_SETTLEMENT_SUBCATEGORIES.map((subcategory) => ({ ...subcategory, isSystem: true })),
  ];
  for (const row of subRows) {
    const exists = await prisma.subcategory.findUnique({ where: { id: row.id }, select: { id: true } });
    if (exists) continue;
    await prisma.subcategory.create({ data: { ...row, normalizedName: normalizeName(row.name), updatedAt: now } });
    insertedSubcategories++;
  }

  for (const mode of PAYMENT_MODES) {
    const exists = await prisma.paymentMode.findUnique({ where: { id: mode.id }, select: { id: true } });
    if (!exists) await prisma.paymentMode.create({ data: { ...mode, normalizedName: normalizeName(mode.name), isSystem: false } });
  }

  for (const account of SYSTEM_ACCOUNTS) {
    const exists = await prisma.accountMaster.findUnique({ where: { id: account.id }, select: { id: true } });
    if (!exists) {
      await prisma.accountMaster.create({
        data: { ...account, normalizedName: normalizeName(account.name), isSystem: true, updatedAt: now },
      });
    }
    if (account.accountType !== "EXTERNAL_INCOME") {
      await prisma.$transaction((tx) => refreshAccounts(tx, [account.id], todayIn("Asia/Kolkata")));
    }
  }

  const settings = await prisma.appSettings.findUnique({ where: { id: 1 }, select: { id: true } });
  if (!settings) await prisma.appSettings.create({ data: { id: 1 } });

  return { insertedCategories, insertedSubcategories };
}
