import path from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";

export type Db = PrismaClient;

export function resolveDatabaseUrl(): string {
  return process.env.DATABASE_URL ?? `file:${path.join(process.cwd(), "data", "accounts.db")}`;
}

/** Opens a Prisma client on a SQLite file with foreign keys, WAL, and busy timeout enabled. */
export async function createDb(url: string = resolveDatabaseUrl()): Promise<Db> {
  const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url, timeout: 5000 }) });
  await prisma.$executeRawUnsafe("PRAGMA foreign_keys = ON");
  await prisma.$executeRawUnsafe("PRAGMA busy_timeout = 5000");
  if (!url.includes(":memory:")) await prisma.$queryRawUnsafe("PRAGMA journal_mode = WAL");
  return prisma;
}

const globalForDb = globalThis as unknown as { __accountsDb?: Promise<Db> };

/** Process-wide singleton used by Route Handlers and Server Components. */
export function getDb(): Promise<Db> {
  globalForDb.__accountsDb ??= createDb();
  return globalForDb.__accountsDb;
}
