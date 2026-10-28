import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { databasePath, upgradeDatabase } from "../scripts/upgrade";
import { freshDb, ROOT } from "./helpers";
import { addTransaction, expenseInput, openAccount } from "./fixtures";

async function populatedDatabase() {
  const client = await freshDb();
  const bank = await openAccount(client, "Upgrade bank", "SAVINGS", "1000000");
  await addTransaction(client, expenseInput({ sourceAccountId: bank.id, amountMinor: 12550n }));
  const files = await client.$queryRawUnsafe<{ name: string; file: string }[]>("PRAGMA database_list");
  const filename = files.find((entry) => entry.name === "main")!.file;
  await client.$disconnect();
  return filename;
}

describe("safe database upgrade", () => {
  it("backs up WAL data and preserves financial records during an additive upgrade", async () => {
    const filename = await populatedDatabase();
    const directory = mkdtempSync(path.join(tmpdir(), "selavu-upgrade-backups-"));
    const writer = new DatabaseSync(filename);
    writer.exec("PRAGMA journal_mode=WAL; UPDATE AccountMaster SET name='WAL account' WHERE name='Upgrade bank'");
    const backup = upgradeDatabase(filename, directory, () => {
      const database = new DatabaseSync(filename);
      database.exec("CREATE TABLE UpgradeProbe (id TEXT PRIMARY KEY)");
      database.close();
    });
    writer.close();
    const saved = new DatabaseSync(backup, { readOnly: true });
    expect(saved.prepare("SELECT name FROM AccountMaster WHERE name='WAL account'").get()).toBeDefined();
    expect(saved.prepare('SELECT COUNT(*) AS count FROM "Transaction"').get()).toMatchObject({ count: 1 });
    saved.close();
    expect(readdirSync(directory)).toHaveLength(1);
  });

  it("restores the original database if migration fails or changes financial records", async () => {
    for (const shouldThrow of [true, false]) {
      const filename = await populatedDatabase();
      const directory = mkdtempSync(path.join(tmpdir(), "selavu-upgrade-rollback-"));
      expect(() => upgradeDatabase(filename, directory, () => {
        const database = new DatabaseSync(filename);
        database.exec('UPDATE "Transaction" SET amountMinor=999');
        database.close();
        if (shouldThrow) throw new Error("Simulated migration failure");
      })).toThrow("the original database was restored");
      const restored = new DatabaseSync(filename, { readOnly: true });
      expect(restored.prepare('SELECT amountMinor FROM "Transaction"').get()).toMatchObject({ amountMinor: 12550 });
      expect(restored.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
      restored.close();
      expect(readdirSync(directory)).toHaveLength(1);
    }
  });

  it("refuses missing databases and non-file URLs", () => {
    expect(() => databasePath("file:/nonexistent/selavu/accounts.db")).toThrow("No database was created");
    expect(() => databasePath("file::memory:")).toThrow("existing local SQLite database");
  });

  it("deploys the pending feature migration, reruns safely, and restores through the CLI", async () => {
    const filename = await populatedDatabase();
    const directory = mkdtempSync(path.join(tmpdir(), "selavu upgrade cli "));
    const previous = new DatabaseSync(filename);
    const migration = readFileSync(path.join(ROOT, "prisma/migrations/20261028180000_savings_and_loan_interest/migration.sql"), "utf8");
    previous.exec(migration.replace(", 'INTEREST_ACCRUAL', 'LOAN_PAYMENT'", ""));
    previous.exec("DELETE FROM _prisma_migrations WHERE migration_name='20261028180000_savings_and_loan_interest'; DELETE FROM Subcategory WHERE parentCategoryId='savings_investments'; DELETE FROM Category WHERE id='savings_investments'");
    previous.close();
    const run = (args: string[]) => execFileSync(process.execPath, [path.join(ROOT, "node_modules/tsx/dist/cli.mjs"), path.join(ROOT, "scripts/upgrade.ts"), ...args], {
      cwd: ROOT,
      env: { ...process.env, DATABASE_URL: `file:${filename}` },
      encoding: "utf8",
      stdio: "pipe",
    });
    expect(() => run([])).toThrow();
    expect(readdirSync(directory)).toHaveLength(0);
    expect(run(["--app-stopped", "--skip-build", "--backup-dir", directory])).toContain("Migration verified");
    const backup = path.join(directory, readdirSync(directory)[0]);
    const upgraded = new DatabaseSync(filename);
    expect(upgraded.prepare("SELECT COUNT(*) AS count FROM Subcategory WHERE parentCategoryId='savings_investments'").get()).toMatchObject({ count: 3 });
    expect(upgraded.prepare('SELECT amountMinor FROM "Transaction"').get()).toMatchObject({ amountMinor: 12550 });
    upgraded.close();
    expect(run(["--app-stopped", "--skip-build", "--backup-dir", directory])).toContain("Migration verified");
    expect(run(["--app-stopped", "--restore", backup, "--backup-dir", directory])).toContain("Pre-restore database retained");
    const restored = new DatabaseSync(filename, { readOnly: true });
    expect(restored.prepare("SELECT COUNT(*) AS count FROM Subcategory WHERE parentCategoryId='savings_investments'").get()).toMatchObject({ count: 0 });
    expect(restored.prepare('SELECT amountMinor FROM "Transaction"').get()).toMatchObject({ amountMinor: 12550 });
    restored.close();
    expect(readdirSync(directory)).toHaveLength(3);
  });
});