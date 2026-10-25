import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/server/db";
import { CARD_SETTLEMENT_CATEGORY, seedCatalog } from "@/server/catalog/catalog";
import { migrateHouseholdCatalog } from "@/server/catalog/migration";
import { createTransaction } from "@/server/domain/transactions";
import { balanceOf, addTransaction, expenseInput, openAccount } from "./fixtures";
import { ctx, freshDb } from "./helpers";

describe("household catalog migration", () => {
  let db: Db;

  beforeAll(async () => {
    db = await freshDb();
  });

  it("remaps clear history, merges budget lines, archives unmatched rows, and is idempotent", async () => {
    const savingsAccount = await openAccount(db, "Catalog Migration Bank", "SAVINGS", "1000000", "2026-01-01");
    const oldSavingsCategory = await db.category.create({ data: {
      id: "savings", name: "Savings", normalizedName: "savings", icon: "savings", color: "#06b6d4", isSystem: false,
    } });
    const [oldGroceries, oldDelivery, oldRent, oldInvestment] = await Promise.all([
      db.subcategory.create({ data: { id: "groceries", parentCategoryId: "food", name: "Groceries", normalizedName: "groceries" } }),
      db.subcategory.create({ data: { id: "instamart", parentCategoryId: "food", name: "Instamart", normalizedName: "instamart" } }),
      db.subcategory.create({ data: { id: "mortgage_rent", parentCategoryId: "housing", name: "Mortgage / Rent", normalizedName: "mortgage / rent" } }),
      db.subcategory.create({ data: { id: "mutual_fund", parentCategoryId: oldSavingsCategory.id, name: "Mutual Fund", normalizedName: "mutual fund" } }),
    ]);
    const budgetId = randomUUID();
    await db.budgetMaster.create({
      data: {
        id: budgetId,
        month: "2026-10",
        details: { create: [
          { id: randomUUID(), categoryId: "food", subcategoryId: oldGroceries.id, planningClass: "EXPENSE", budgetAmountMinor: 80000n },
          { id: randomUUID(), categoryId: "food", subcategoryId: oldDelivery.id, planningClass: "EXPENSE", budgetAmountMinor: 20000n },
          { id: randomUUID(), categoryId: oldSavingsCategory.id, subcategoryId: oldInvestment.id, planningClass: "EXPENSE", budgetAmountMinor: 50000n },
        ] },
      },
    });

    const groceries = await addTransaction(db, expenseInput({ sourceAccountId: savingsAccount.id, amountMinor: 25000n, categoryId: "food", subcategoryId: oldGroceries.id, description: "Market" }));
    const delivery = await addTransaction(db, expenseInput({ sourceAccountId: savingsAccount.id, amountMinor: 5000n, categoryId: "food", subcategoryId: oldDelivery.id, description: "Delivery" }));
    const rent = await addTransaction(db, expenseInput({ sourceAccountId: savingsAccount.id, amountMinor: 120000n, categoryId: "housing", subcategoryId: oldRent.id, description: "Monthly rent" }));
    const investment = await addTransaction(db, expenseInput({ sourceAccountId: savingsAccount.id, amountMinor: 40000n, categoryId: oldSavingsCategory.id, subcategoryId: oldInvestment.id, description: "Legacy investment" }));
    const cardAccount = await openAccount(db, "Migration Test Card", "CREDIT_CARD", "0", "2026-01-01");
    const cardPayment = await db.$transaction((tx) => createTransaction(tx, {
      type: "FINANCIAL",
      financialKind: "CARD_PAYMENT",
      date: "2026-10-15",
      description: "Card bill",
      amountMinor: 12000n,
      sourceAccountId: savingsAccount.id,
      destinationAccountId: cardAccount.id,
      categoryId: CARD_SETTLEMENT_CATEGORY.id,
      subcategoryId: "credit_card_1",
    }, ctx));
    const oldLoanCategory = await db.category.create({ data: {
      id: "loan", name: "Loan", normalizedName: "loan", icon: "account_balance", color: "#ef4444", isSystem: false,
    } });
    await db.subcategory.update({ where: { id: "credit_card_1" }, data: { parentCategoryId: oldLoanCategory.id, isSystem: false } });
    const oldCardDetail = await db.budgetDetail.create({ data: {
      id: randomUUID(), budgetMasterId: budgetId, categoryId: oldLoanCategory.id, subcategoryId: "credit_card_1",
      planningClass: "CARD_SETTLEMENT", budgetAmountMinor: 50000n,
    } });
    await db.transaction.update({ where: { id: cardPayment.id }, data: { categoryId: oldLoanCategory.id, budgetDetailId: oldCardDetail.id, budgetImpactMinor: 12000n } });
    const balanceBefore = await balanceOf(db, savingsAccount.id);

    await seedCatalog(db);
    const result = await db.$transaction((tx) => migrateHouseholdCatalog(tx, "catalog-migration-test"));
    expect(result.applied).toBe(true);
    expect(result.mappedTransactions).toBe(4);

    for (const id of [groceries.id, delivery.id]) {
      await expect(db.transaction.findUniqueOrThrow({ where: { id } })).resolves.toMatchObject({ categoryId: "groceries_everyday", subcategoryId: "provisions" });
    }
    await expect(db.transaction.findUniqueOrThrow({ where: { id: rent.id } })).resolves.toMatchObject({ categoryId: "housing", subcategoryId: "rent" });
    await expect(db.transaction.findUniqueOrThrow({ where: { id: investment.id } })).resolves.toMatchObject({ categoryId: "savings", subcategoryId: "mutual_fund" });
    await expect(db.transaction.findUniqueOrThrow({ where: { id: cardPayment.id } })).resolves.toMatchObject({ categoryId: CARD_SETTLEMENT_CATEGORY.id, subcategoryId: "credit_card_1", budgetImpactMinor: 12000n });
    expect(await db.subcategory.findUniqueOrThrow({ where: { id: "mutual_fund" } })).toMatchObject({ archivedAt: expect.any(Date) });
    expect(await db.category.findUniqueOrThrow({ where: { id: "savings" } })).toMatchObject({ archivedAt: expect.any(Date) });
    expect(await balanceOf(db, savingsAccount.id)).toBe(balanceBefore);

    const provisions = await db.budgetDetail.findUniqueOrThrow({ where: { budgetMasterId_categoryId_subcategoryId: { budgetMasterId: budgetId, categoryId: "groceries_everyday", subcategoryId: "provisions" } } });
    expect(provisions.budgetAmountMinor).toBe(100000n);
    expect(provisions.spendMinor).toBe(30000n);
    const budget = await db.budgetMaster.findUniqueOrThrow({ where: { id: budgetId } });
    expect(budget.totalProjectedExpenditureMinor).toBe(100000n);
    expect(budget.balanceProvisioningMinor).toBe(70000n);
    expect(budget.settlementPlannedMinor).toBe(50000n);
    expect(budget.settlementUsedMinor).toBe(12000n);
    expect(await db.budgetDetail.count({ where: { budgetMasterId: budgetId, subcategoryId: oldInvestment.id } })).toBe(0);
    expect(await db.subcategory.findUniqueOrThrow({ where: { id: "credit_card_1" } })).toMatchObject({ parentCategoryId: CARD_SETTLEMENT_CATEGORY.id, isSystem: true });

    await expect(db.$transaction((tx) => migrateHouseholdCatalog(tx, "catalog-migration-test"))).resolves.toMatchObject({ applied: false });
    expect(await db.auditEvent.count({ where: { entityType: "CatalogMigration", entityId: "south-indian-household-catalog-v1" } })).toBe(1);
  });
});
