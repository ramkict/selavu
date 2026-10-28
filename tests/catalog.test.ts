import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createDb } from "@/server/db";
import type { Db } from "@/server/db";
import { CATALOG, CARD_SETTLEMENT_CATEGORY, seedCatalog } from "@/server/catalog/catalog";
import { freshDb } from "./helpers";
import { addBudget, addTransaction, expenseInput, openAccount } from "./fixtures";

describe("catalog seed", () => {
  let db: Db;
  beforeAll(async () => {
    db = await freshDb();
  });

  it("seeds household and savings categories with stable IDs", async () => {
    const categories = await db.category.findMany({ where: { isSystem: false }, include: { subcategories: { where: { isSystem: false } } } });
    expect(CATALOG).toHaveLength(14);
    expect(categories).toHaveLength(14);
    expect(categories.reduce((n, c) => n + c.subcategories.length, 0)).toBe(71);

    for (const entry of CATALOG) {
      const row = categories.find((c) => c.id === entry.id);
      expect(row, entry.id).toBeDefined();
      expect(row!.name).toBe(entry.name);
      expect(row!.icon).toBe(entry.icon);
      expect(row!.color).toBe(entry.color);
      for (const sub of entry.subCategories) {
        const child = row!.subcategories.find((s) => s.id === sub.id);
        expect(child, sub.id).toBeDefined();
        expect(child!.name).toBe(sub.name);
        expect(child!.parentCategoryId).toBe(entry.id);
      }
    }
  });

  it("keeps protected system classifications and endpoints separate from the supplied records", async () => {
    const system = await db.subcategory.findUniqueOrThrow({ where: { id: "sys_transfer" }, include: { parent: true } });
    expect(system.isSystem).toBe(true);
    expect(system.parent.id).toBe("sys_accounts");
    expect(system.parent.isSystem).toBe(true);
    const systemAccounts = await db.accountMaster.findMany({ where: { isSystem: true }, orderBy: { id: "asc" } });
    expect(systemAccounts.map((a) => a.id)).toEqual(["sys_cash_in_hand", "sys_expense", "sys_income"]);
    expect(systemAccounts.find((a) => a.id === "sys_cash_in_hand")!.accountType).toBe("CASH");
    const settlement = await db.category.findUniqueOrThrow({ where: { id: CARD_SETTLEMENT_CATEGORY.id }, include: { subcategories: true } });
    expect(settlement.isSystem).toBe(true);
    expect(settlement.subcategories.filter((subcategory) => subcategory.isSystem).map((subcategory) => subcategory.id).sort()).toEqual([
      "credit_card_1", "credit_card_2", "credit_card_3",
    ]);
  });

  it("re-seeding inserts nothing and never overwrites user edits", async () => {
    await db.category.update({ where: { id: "food" }, data: { name: "Groceries & Dining" } });
    const result = await seedCatalog(db);
    expect(result).toEqual({ insertedCategories: 0, insertedSubcategories: 0 });
    expect((await db.category.findUniqueOrThrow({ where: { id: "food" } })).name).toBe("Groceries & Dining");
  });

  it("preserves populated financial records when upgrading the transaction constraint", async () => {
    const isolated = await freshDb();
    const bank = await openAccount(isolated, "Preserved bank", "SAVINGS", "1000000");
    await addBudget(isolated, "2026-10", { provisions: 100000n });
    await addTransaction(isolated, expenseInput({ sourceAccountId: bank.id, amountMinor: 10000n }));
    const snapshot = async (client: Db) => ({
      accounts: await client.accountMaster.findMany({ orderBy: { id: "asc" } }),
      transactions: await client.transaction.findMany({ orderBy: { id: "asc" } }),
      postings: await client.transactionPosting.findMany({ orderBy: { id: "asc" } }),
      budgets: await client.budgetMaster.findMany({ orderBy: { id: "asc" } }),
      details: await client.budgetDetail.findMany({ orderBy: { id: "asc" } }),
      months: await client.runningAccount.findMany({ orderBy: { id: "asc" } }),
      audits: await client.auditEvent.findMany({ orderBy: { id: "asc" } }),
    });
    const before = await snapshot(isolated);
    const files = await isolated.$queryRawUnsafe<{ name: string; file: string }[]>("PRAGMA database_list");
    const filename = files.find((entry) => entry.name === "main")!.file;
    await isolated.$disconnect();
    const sqlite = new DatabaseSync(filename);
    const migration = readFileSync(new URL("../prisma/migrations/20261028180000_savings_and_loan_interest/migration.sql", import.meta.url), "utf8");
    sqlite.exec(migration.replace(", 'INTEREST_ACCRUAL', 'LOAN_PAYMENT'", ""));
    sqlite.exec(migration);
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    sqlite.close();
    const reopened = await createDb(`file:${filename}`);
    expect(await snapshot(reopened)).toEqual(before);
    await reopened.$disconnect();
  });
});
