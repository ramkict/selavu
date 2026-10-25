import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/server/db";
import { CATALOG, seedCatalog } from "@/server/catalog/catalog";
import { freshDb } from "./helpers";

describe("catalog seed", () => {
  let db: Db;
  beforeAll(async () => {
    db = await freshDb();
  });

  it("seeds exactly the 12 categories and 77 subcategories from cat.json with stable IDs", async () => {
    const categories = await db.category.findMany({ where: { isSystem: false }, include: { subcategories: { where: { isSystem: false } } } });
    expect(CATALOG).toHaveLength(12);
    expect(categories).toHaveLength(12);
    expect(categories.reduce((n, c) => n + c.subcategories.length, 0)).toBe(77);

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
  });

  it("re-seeding inserts nothing and never overwrites user edits", async () => {
    await db.category.update({ where: { id: "food" }, data: { name: "Groceries & Dining" } });
    const result = await seedCatalog(db);
    expect(result).toEqual({ insertedCategories: 0, insertedSubcategories: 0 });
    expect((await db.category.findUniqueOrThrow({ where: { id: "food" } })).name).toBe("Groceries & Dining");
  });
});
