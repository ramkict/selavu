import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/server/db";
import { createCategory, createSubcategory, updateCategory, updateSubcategory } from "@/server/domain/categories";
import { updateTransaction } from "@/server/domain/transactions";
import { freshDb, ctx } from "./helpers";
import { addTransaction, expenseInput, openAccount } from "./fixtures";

describe("category administration", () => {
  let db: Db;
  let savings: { id: string };

  beforeAll(async () => {
    db = await freshDb();
    savings = await openAccount(db, "Catalog Test Savings", "SAVINGS", "500000", "2026-01-01");
  });

  it("creates definitions, rejects duplicates, and preserves history through renames", async () => {
    const category = await db.$transaction((tx) => createCategory(tx, { name: "  Home   care ", icon: "house", color: "#087f77" }, ctx));
    const subcategory = await db.$transaction((tx) => createSubcategory(tx, { parentCategoryId: category.id, name: "Cleaning" }, ctx));
    expect(category.name).toBe("Home care");
    await expect(db.$transaction((tx) => createCategory(tx, { name: "home care", icon: "tag", color: "#087f77" }, ctx))).rejects.toMatchObject({ status: 409 });

    const transaction = await addTransaction(db, expenseInput({ sourceAccountId: savings.id, amountMinor: 2500n, categoryId: category.id, subcategoryId: subcategory.id, description: "Supplies" }));
    await db.$transaction((tx) => updateCategory(tx, category.id, category.version, { name: "Household" }, ctx));
    await db.$transaction((tx) => updateSubcategory(tx, subcategory.id, subcategory.version, { name: "Cleaning products" }, ctx));
    const stored = await db.transaction.findUniqueOrThrow({ where: { id: transaction.id }, include: { subcategory: { include: { parent: true } } } });
    expect(stored.subcategory.name).toBe("Cleaning products");
    expect(stored.subcategory.parent.name).toBe("Household");
  });

  it("archives without deleting history and restores with version checks", async () => {
    const category = await db.$transaction((tx) => createCategory(tx, { name: "Pet care", icon: "heart", color: "#df705d" }, ctx));
    const subcategory = await db.$transaction((tx) => createSubcategory(tx, { parentCategoryId: category.id, name: "Food" }, ctx));
    const transaction = expenseInput({ sourceAccountId: savings.id, amountMinor: 1200n, categoryId: category.id, subcategoryId: subcategory.id });
    const existingTransaction = await addTransaction(db, transaction);

    const archived = await db.$transaction((tx) => updateSubcategory(tx, subcategory.id, subcategory.version, { archived: true }, ctx));
    await expect(addTransaction(db, transaction)).rejects.toMatchObject({ status: 422 });
    const edited = await db.$transaction((tx) => updateTransaction(tx, existingTransaction.id, existingTransaction.version, {
      type: "EXPENSE",
      financialKind: null,
      date: existingTransaction.date,
      description: "Updated historic expense",
      amountMinor: 1200n,
      sourceAccountId: savings.id,
      destinationAccountId: "sys_expense",
      paymentModeId: "upi",
      expenseLocation: "CHE",
      categoryId: category.id,
      subcategoryId: subcategory.id,
      incomeType: null,
      incomeSourceLabel: null,
      recurring: false,
    }, ctx));
    expect(edited.description).toBe("Updated historic expense");
    const restored = await db.$transaction((tx) => updateSubcategory(tx, subcategory.id, archived.version, { archived: false }, ctx));
    expect(restored.archivedAt).toBeNull();
    await expect(db.$transaction((tx) => updateCategory(tx, category.id, category.version + 2, { archived: true }, ctx))).rejects.toMatchObject({ status: 409 });
  });
});