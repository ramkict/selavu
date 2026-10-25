import { createDb, resolveDatabaseUrl } from "../src/server/db";
import { seedCatalog } from "../src/server/catalog/catalog";
import { migrateHouseholdCatalog } from "../src/server/catalog/migration";

async function main() {
  const db = await createDb(resolveDatabaseUrl());
  try {
    await seedCatalog(db);
    const result = await db.$transaction((tx) => migrateHouseholdCatalog(tx));
    console.log(result.applied ? `Household catalog migration complete: ${result.mappedTransactions} transactions remapped; ${result.archivedDefinitions} legacy definitions archived.` : "Household catalog migration was already applied.");
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error("Household catalog migration failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});