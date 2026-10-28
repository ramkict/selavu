import { randomUUID, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FINANCIAL_TABLES = ["AccountMaster", "RunningAccount", "Transaction", "TransactionPosting", "BudgetMaster", "BudgetDetail", "AuditEvent"];

export function databasePath(url: string) {
  if (!url.startsWith("file:") || url.includes("?") || url.includes("#") || url.includes(":memory:")) {
    throw new Error("Use a file: DATABASE_URL for an existing local SQLite database, without query parameters.");
  }
  const filename = url.startsWith("file://") ? fileURLToPath(url) : path.resolve(url.slice(5));
  if (!existsSync(filename) || !statSync(filename).isFile()) throw new Error(`Existing database not found: ${filename}. No database was created.`);
  return filename;
}

function inspect(filename: string) {
  const database = new DatabaseSync(filename, { readOnly: true });
  try {
    const integrity = database.prepare("PRAGMA integrity_check").all();
    if (integrity.length !== 1 || Object.values(integrity[0])[0] !== "ok") throw new Error(`SQLite integrity check failed: ${filename}`);
    if (database.prepare("PRAGMA foreign_key_check").all().length) throw new Error(`SQLite foreign key check failed: ${filename}`);
    return Object.fromEntries(FINANCIAL_TABLES.map((table) => {
      const statement = database.prepare(`SELECT * FROM "${table}" ORDER BY "id"`);
      statement.setReadBigInts(true);
      const hash = createHash("sha256");
      for (const row of statement.iterate()) hash.update(JSON.stringify(row, (_key, value) => typeof value === "bigint" ? value.toString() : value) + "\n");
      return [table, hash.digest("hex")];
    }));
  } finally {
    database.close();
  }
}

export function backupDatabase(filename: string, directory: string) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const destination = path.join(directory, `${path.basename(filename)}.${new Date().toISOString().replaceAll(":", "-")}.${randomUUID()}.db`);
  const database = new DatabaseSync(filename, { readOnly: true });
  try {
    database.prepare("VACUUM INTO ?").run(destination);
    chmodSync(destination, 0o600);
  } finally {
    database.close();
  }
  inspect(destination);
  return destination;
}

function replaceDatabase(filename: string, backup: string) {
  inspect(backup);
  const replacement = `${filename}.restore-${randomUUID()}`;
  try {
    const source = new DatabaseSync(backup, { readOnly: true });
    try {
      source.prepare("VACUUM INTO ?").run(replacement);
    } finally {
      source.close();
    }
    chmodSync(replacement, 0o600);
    inspect(replacement);
    rmSync(`${filename}-wal`, { force: true });
    rmSync(`${filename}-shm`, { force: true });
    rmSync(`${filename}-journal`, { force: true });
    renameSync(replacement, filename);
    inspect(filename);
  } finally {
    rmSync(replacement, { force: true });
  }
}

export function upgradeDatabase(filename: string, directory: string, migrate: () => void) {
  const before = inspect(filename);
  const backup = backupDatabase(filename, directory);
  console.log(`Verified backup: ${backup}`);
  try {
    migrate();
    const after = inspect(filename);
    for (const table of FINANCIAL_TABLES) {
      if (before[table] !== after[table]) throw new Error(`Existing financial records changed in ${table}.`);
    }
    return backup;
  } catch (error) {
    try {
      replaceDatabase(filename, backup);
    } catch (restoreError) {
      throw new Error(`Upgrade failed and automatic restore failed. Keep the app stopped. Verified backup: ${backup}`, { cause: new AggregateError([error, restoreError]) });
    }
    throw new Error(`Upgrade failed; the original database was restored. Backup retained at ${backup}`, { cause: error });
  }
}

function main() {
  const { values } = parseArgs({ options: {
    "app-stopped": { type: "boolean" },
    "backup-dir": { type: "string" },
    restore: { type: "string" },
    "skip-build": { type: "boolean" },
    help: { type: "boolean" },
  } });
  if (values.help) {
    console.log("npm run upgrade -- --app-stopped [--backup-dir PATH] [--skip-build]\nnpm run upgrade -- --app-stopped --restore BACKUP\nStop every app process using this database first. Existing financial records must remain unchanged.");
    return;
  }
  if (!values["app-stopped"]) throw new Error("Stop every app process using this database, then pass --app-stopped. No database changes were made.");
  process.chdir(ROOT);
  if (existsSync(".env")) process.loadEnvFile(".env");
  const filename = databasePath(process.env.DATABASE_URL ?? "file:./data/accounts.db");
  const directory = path.resolve(values["backup-dir"] ?? "backups");
  console.log(`Database: ${filename}`);
  if (values.restore) {
    const backup = path.resolve(values.restore);
    inspect(backup);
    const safetyBackup = backupDatabase(filename, directory);
    replaceDatabase(filename, backup);
    console.log(`Restored ${backup}. Pre-restore database retained at ${safetyBackup}. Restart only with code compatible with the restored schema.`);
    return;
  }
  const backup = upgradeDatabase(filename, directory, () => {
    execFileSync(process.execPath, [path.join(ROOT, "node_modules/prisma/build/index.js"), "migrate", "deploy"], {
      cwd: ROOT,
      env: { ...process.env, DATABASE_URL: `file:${filename}` },
      stdio: "inherit",
    });
  });
  console.log(`Migration verified. Existing financial records are unchanged. Backup: ${backup}`);
  if (!values["skip-build"]) {
    try {
      execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"], {
        cwd: ROOT, env: { ...process.env, DATABASE_URL: `file:${filename}` }, stdio: "inherit",
      });
    } catch (error) {
      throw new Error(`Migration succeeded and data is preserved, but the build failed. Keep the app stopped, fix the build, and rerun npm run build. Backup: ${backup}`, { cause: error });
    }
  }
  console.log("Upgrade complete. No seed or reset was run. Data stayed in place; no restore is needed.");
  console.log(values["skip-build"] ? "Start with npm run dev, or run npm run build before npm run start." : "Start with npm run start (or npm run dev).");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}