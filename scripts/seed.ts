/**
 * Idempotent catalog seed for the configured database (DATABASE_URL or ./data/accounts.db).
 * Inserts only missing catalog/system records; never overwrites edits or financial facts.
 * Run after `npm run db:migrate`.
 */
import { createDb, resolveDatabaseUrl } from "../src/server/db";
import { seedCatalog } from "../src/server/catalog/catalog";

async function main() {
  const db = await createDb(resolveDatabaseUrl());
  try {
    const result = await seedCatalog(db);
    console.log(`Catalog seed complete: ${result.insertedCategories} categories and ${result.insertedSubcategories} subcategories inserted.`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error("Seed failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
