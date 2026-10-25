import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDb, type Db } from "@/server/db";
import { seedCatalog } from "@/server/catalog/catalog";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const TODAY = "2026-10-22";
export const ctx = { today: TODAY, requestId: "test" };

/** Creates a fresh temporary SQLite database, applies all migrations, and seeds the catalog. */
export async function freshDb(): Promise<Db> {
  const dir = mkdtempSync(path.join(os.tmpdir(), "accounts-test-"));
  const url = `file:${path.join(dir, "test.db")}`;
  execFileSync(path.join(ROOT, "node_modules/.bin/prisma"), ["migrate", "deploy"], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
  const db = await createDb(url);
  await seedCatalog(db);
  return db;
}
