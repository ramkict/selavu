import { CATALOG, CARD_SETTLEMENT_CATEGORY, CARD_SETTLEMENT_SUBCATEGORIES, defaultPlanningClass } from "./catalog";
import { audit, bumpDataRevision, refreshBudgetMonth, type Tx } from "../domain/projections";
import { normalizeName } from "../lib/text";

const ACTIVE_LEGACY_CATEGORY_IDS = new Set(["housing", "food", "transportation", "personal_care", "entertainment", "donation"]);
const LEGACY_CATEGORY_IDS = ["housing", "food", "personal_care", "entertainment", "savings", "miscellaneous", "transportation", "insurance", "children", "loan", "tax", "donation"];
const LEGACY_SUBCATEGORY_IDS = [
  "mortgage_rent", "phone_internet", "mobile", "electricity", "maintenance_housing", "gas", "servant", "supplies_sewage", "cable", "others_housing",
  "groceries", "dining_out", "coffee_snacks", "fruits_vegetables", "water", "others_food", "instamart",
  "clothing", "health_medical", "personal_hygiene", "hair_beauty", "health_club", "others_personal_care",
  "movies_shows", "games_hobbies", "books_magazines", "sports_fitness", "sporting_events", "live_theater", "others_entertainment",
  "mutual_fund", "children_savings", "savings_3", "others_savings", "gifts_donations", "subscriptions", "office_supplies", "other",
  "fuel", "public_transport", "vehicle_maintenance", "parking_tolls", "vehicle_payments", "vehicle_1_insurance", "vehicle_2_insurance", "petrol_vehicle_1", "petrol_vehicle_2", "bus_taxi_auto", "others_transportation",
  "life_insurance", "medical_insurance", "home_insurance", "child_insurance", "others_insurance",
  "child_medical", "child_clothing", "school_tuition", "school_supplies", "organization_dues", "child_lunch_money", "child_care", "toys_games", "others_children",
  "personal_loan", "educational_loan", "vehicle_loan", "credit_card_1", "credit_card_2", "credit_card_3", "others_loan",
  "income_tax", "professional_tax", "tn_labour_fund", "others_tax", "gifts_donation_1", "gifts_donation_2", "others_gifts",
];

type Mapping = { fromCategory: string; fromSubcategory: string; toCategory: string; toSubcategory: string };

const MAPPINGS: Mapping[] = [
  { fromCategory: "housing", fromSubcategory: "mortgage_rent", toCategory: "housing", toSubcategory: "rent" },
  { fromCategory: "housing", fromSubcategory: "maintenance_housing", toCategory: "housing", toSubcategory: "apartment_maintenance" },
  { fromCategory: "housing", fromSubcategory: "electricity", toCategory: "housing", toSubcategory: "electricity" },
  { fromCategory: "housing", fromSubcategory: "gas", toCategory: "housing", toSubcategory: "lpg_cylinder" },
  { fromCategory: "housing", fromSubcategory: "servant", toCategory: "housing", toSubcategory: "domestic_help" },
  { fromCategory: "housing", fromSubcategory: "mobile", toCategory: "communications", toSubcategory: "mobile_bills_recharges" },
  { fromCategory: "housing", fromSubcategory: "cable", toCategory: "communications", toSubcategory: "streaming_subscriptions" },
  { fromCategory: "food", fromSubcategory: "groceries", toCategory: "groceries_everyday", toSubcategory: "provisions" },
  { fromCategory: "food", fromSubcategory: "instamart", toCategory: "groceries_everyday", toSubcategory: "provisions" },
  { fromCategory: "food", fromSubcategory: "dining_out", toCategory: "food", toSubcategory: "dine_out" },
  { fromCategory: "food", fromSubcategory: "coffee_snacks", toCategory: "food", toSubcategory: "snacks" },
  { fromCategory: "food", fromSubcategory: "fruits_vegetables", toCategory: "groceries_everyday", toSubcategory: "vegetables_fruits" },
  { fromCategory: "food", fromSubcategory: "water", toCategory: "housing", toSubcategory: "water_supply" },
  { fromCategory: "personal_care", fromSubcategory: "clothing", toCategory: "personal_care", toSubcategory: "everyday_clothing" },
  { fromCategory: "personal_care", fromSubcategory: "health_medical", toCategory: "healthcare", toSubcategory: "doctor_hospital" },
  { fromCategory: "personal_care", fromSubcategory: "personal_hygiene", toCategory: "personal_care", toSubcategory: "toiletries_personal_care" },
  { fromCategory: "personal_care", fromSubcategory: "hair_beauty", toCategory: "personal_care", toSubcategory: "haircuts_grooming" },
  { fromCategory: "personal_care", fromSubcategory: "health_club", toCategory: "entertainment", toSubcategory: "sports_fitness" },
  { fromCategory: "entertainment", fromSubcategory: "movies_shows", toCategory: "entertainment", toSubcategory: "movies_performances" },
  { fromCategory: "entertainment", fromSubcategory: "games_hobbies", toCategory: "entertainment", toSubcategory: "books_games_hobbies" },
  { fromCategory: "entertainment", fromSubcategory: "books_magazines", toCategory: "entertainment", toSubcategory: "books_games_hobbies" },
  { fromCategory: "entertainment", fromSubcategory: "sports_fitness", toCategory: "entertainment", toSubcategory: "sports_fitness" },
  { fromCategory: "entertainment", fromSubcategory: "live_theater", toCategory: "entertainment", toSubcategory: "movies_performances" },
  { fromCategory: "miscellaneous", fromSubcategory: "gifts_donations", toCategory: "donation", toSubcategory: "donations" },
  { fromCategory: "transportation", fromSubcategory: "fuel", toCategory: "transportation", toSubcategory: "fuel_charging" },
  { fromCategory: "transportation", fromSubcategory: "public_transport", toCategory: "transportation", toSubcategory: "public_transport" },
  { fromCategory: "transportation", fromSubcategory: "vehicle_maintenance", toCategory: "transportation", toSubcategory: "vehicle_service_repairs" },
  { fromCategory: "transportation", fromSubcategory: "parking_tolls", toCategory: "transportation", toSubcategory: "parking_tolls" },
  { fromCategory: "transportation", fromSubcategory: "vehicle_1_insurance", toCategory: "insurance_taxes", toSubcategory: "vehicle_insurance" },
  { fromCategory: "transportation", fromSubcategory: "vehicle_2_insurance", toCategory: "insurance_taxes", toSubcategory: "vehicle_insurance" },
  { fromCategory: "transportation", fromSubcategory: "petrol_vehicle_1", toCategory: "transportation", toSubcategory: "fuel_charging" },
  { fromCategory: "transportation", fromSubcategory: "petrol_vehicle_2", toCategory: "transportation", toSubcategory: "fuel_charging" },
  { fromCategory: "transportation", fromSubcategory: "bus_taxi_auto", toCategory: "transportation", toSubcategory: "auto_taxi_app_rides" },
  { fromCategory: "insurance", fromSubcategory: "life_insurance", toCategory: "insurance_taxes", toSubcategory: "life_insurance" },
  { fromCategory: "insurance", fromSubcategory: "medical_insurance", toCategory: "healthcare", toSubcategory: "health_insurance" },
  { fromCategory: "children", fromSubcategory: "child_clothing", toCategory: "personal_care", toSubcategory: "everyday_clothing" },
  { fromCategory: "children", fromSubcategory: "child_medical", toCategory: "healthcare", toSubcategory: "doctor_hospital" },
  { fromCategory: "children", fromSubcategory: "school_tuition", toCategory: "education", toSubcategory: "school_college_fees" },
  { fromCategory: "children", fromSubcategory: "school_supplies", toCategory: "education", toSubcategory: "books_stationery_uniforms" },
  { fromCategory: "children", fromSubcategory: "child_care", toCategory: "education", toSubcategory: "daycare_after_school" },
  { fromCategory: "children", fromSubcategory: "toys_games", toCategory: "entertainment", toSubcategory: "books_games_hobbies" },
  { fromCategory: "loan", fromSubcategory: "credit_card_1", toCategory: CARD_SETTLEMENT_CATEGORY.id, toSubcategory: "credit_card_1" },
  { fromCategory: "loan", fromSubcategory: "credit_card_2", toCategory: CARD_SETTLEMENT_CATEGORY.id, toSubcategory: "credit_card_2" },
  { fromCategory: "loan", fromSubcategory: "credit_card_3", toCategory: CARD_SETTLEMENT_CATEGORY.id, toSubcategory: "credit_card_3" },
  { fromCategory: "tax", fromSubcategory: "income_tax", toCategory: "insurance_taxes", toSubcategory: "other_fees" },
  { fromCategory: "tax", fromSubcategory: "professional_tax", toCategory: "insurance_taxes", toSubcategory: "other_fees" },
  { fromCategory: "tax", fromSubcategory: "tn_labour_fund", toCategory: "insurance_taxes", toSubcategory: "other_fees" },
  { fromCategory: "donation", fromSubcategory: "gifts_donation_1", toCategory: "donation", toSubcategory: "donations" },
  { fromCategory: "donation", fromSubcategory: "gifts_donation_2", toCategory: "donation", toSubcategory: "donations" },
  { fromCategory: "donation", fromSubcategory: "others_gifts", toCategory: "donation", toSubcategory: "donations" },
];

const TARGET_SUBCATEGORY_IDS = new Set([
  ...CATALOG.flatMap((category) => category.subCategories.map((subcategory) => subcategory.id)),
  ...CARD_SETTLEMENT_SUBCATEGORIES.map((subcategory) => subcategory.id),
]);

export async function migrateHouseholdCatalog(tx: Tx, requestId?: string) {
  const migrationId = "south-indian-household-catalog-v1";
  const previous = await tx.auditEvent.findFirst({ where: { entityType: "CatalogMigration", entityId: migrationId }, select: { id: true } });
  if (previous) return { applied: false, mappedTransactions: 0, archivedDefinitions: 0 };

  const now = new Date();
  for (const category of CATALOG) {
    const exists = await tx.category.findUnique({ where: { id: category.id } });
    if (!exists) throw new Error(`Seed the target category before migrating: ${category.id}`);
    if (exists.name !== category.name || exists.icon !== category.icon || exists.color !== category.color || exists.archivedAt) {
      await tx.category.update({
        where: { id: category.id },
        data: { name: category.name, normalizedName: normalizeName(category.name), icon: category.icon, color: category.color, archivedAt: null, version: { increment: 1 } },
      });
    }
  }

  const months = new Set<string>();
  let mappedTransactions = 0;
  for (const mapping of MAPPINGS) {
    const target = await tx.subcategory.findUnique({ where: { id: mapping.toSubcategory } });
    if (!target || (target.parentCategoryId !== mapping.toCategory && mapping.fromSubcategory !== mapping.toSubcategory)) {
      throw new Error(`Seed the target subcategory before migrating: ${mapping.toSubcategory}`);
    }

    const transactions = await tx.transaction.findMany({
      where: { categoryId: mapping.fromCategory, subcategoryId: mapping.fromSubcategory },
      select: { id: true, date: true },
    });
    if (mapping.fromCategory !== mapping.toCategory || mapping.fromSubcategory !== mapping.toSubcategory) {
      await tx.transaction.updateMany({
        where: { categoryId: mapping.fromCategory, subcategoryId: mapping.fromSubcategory },
        data: { categoryId: mapping.toCategory, subcategoryId: mapping.toSubcategory, budgetDetailId: null, budgetImpactMinor: 0n, version: { increment: 1 }, updatedAt: now },
      });
      mappedTransactions += transactions.length;
      transactions.forEach((transaction) => months.add(transaction.date.slice(0, 7)));

      const details = await tx.budgetDetail.findMany({
        where: { categoryId: mapping.fromCategory, subcategoryId: mapping.fromSubcategory },
        include: { budgetMaster: { select: { month: true } } },
      });
      for (const detail of details) {
        months.add(detail.budgetMaster.month);
        const targetDetail = await tx.budgetDetail.findUnique({
          where: { budgetMasterId_categoryId_subcategoryId: { budgetMasterId: detail.budgetMasterId, categoryId: mapping.toCategory, subcategoryId: mapping.toSubcategory } },
        });
        if (targetDetail && targetDetail.id !== detail.id) {
          await tx.budgetDetail.update({ where: { id: targetDetail.id }, data: { budgetAmountMinor: targetDetail.budgetAmountMinor + detail.budgetAmountMinor, version: { increment: 1 } } });
          await tx.budgetDetail.delete({ where: { id: detail.id } });
        } else {
          await tx.budgetDetail.update({
            where: { id: detail.id },
            data: { categoryId: mapping.toCategory, subcategoryId: mapping.toSubcategory, planningClass: defaultPlanningClass(mapping.toCategory, mapping.toSubcategory), version: { increment: 1 } },
          });
        }
      }
    }

    const source = await tx.subcategory.findUnique({ where: { id: mapping.fromSubcategory } });
    if (source && mapping.fromSubcategory === mapping.toSubcategory) {
      await tx.subcategory.update({
        where: { id: source.id },
        data: {
          parentCategoryId: mapping.toCategory,
          name: target.name,
          normalizedName: normalizeName(target.name),
          isSystem: mapping.toCategory === CARD_SETTLEMENT_CATEGORY.id,
          archivedAt: null,
          version: { increment: 1 },
        },
      });
    } else if (source) {
      await tx.subcategory.update({ where: { id: source.id }, data: { archivedAt: now, version: { increment: 1 } } });
    }
  }

  const archivedCategories = LEGACY_CATEGORY_IDS.filter((id) => !ACTIVE_LEGACY_CATEGORY_IDS.has(id));
  for (const id of archivedCategories) {
    await tx.category.updateMany({ where: { id, isSystem: false, archivedAt: null }, data: { archivedAt: now, version: { increment: 1 } } });
  }

  const mappedSubcategories = new Set(MAPPINGS.map((mapping) => mapping.fromSubcategory));
  const unmatchedSubcategories = LEGACY_SUBCATEGORY_IDS.filter((id) => !mappedSubcategories.has(id));
  const unmatchedDetails = await tx.budgetDetail.findMany({
    where: { subcategoryId: { in: unmatchedSubcategories } },
    select: { id: true, budgetMaster: { select: { month: true } } },
  });
  if (unmatchedDetails.length) {
    const detailIds = unmatchedDetails.map((detail) => detail.id);
    unmatchedDetails.forEach((detail) => months.add(detail.budgetMaster.month));
    await tx.transaction.updateMany({ where: { budgetDetailId: { in: detailIds } }, data: { budgetDetailId: null, budgetImpactMinor: 0n } });
    await tx.budgetDetail.deleteMany({ where: { id: { in: detailIds } } });
  }
  const archivedSubcategories = LEGACY_SUBCATEGORY_IDS.filter((id) => !TARGET_SUBCATEGORY_IDS.has(id));
  const archived = await tx.subcategory.updateMany({ where: { id: { in: archivedSubcategories }, isSystem: false, archivedAt: null }, data: { archivedAt: now, version: { increment: 1 } } });

  for (const month of months) {
    await tx.budgetMaster.updateMany({ where: { month }, data: { version: { increment: 1 } } });
    await refreshBudgetMonth(tx, month);
  }
  await bumpDataRevision(tx);
  await audit(tx, {
    action: "APPLY",
    entityType: "CatalogMigration",
    entityId: migrationId,
    after: { mappedTransactions, archivedCategories: archivedCategories.length, archivedSubcategories: archived.count },
    requestId,
  });
  return { applied: true, mappedTransactions, archivedDefinitions: archivedCategories.length + archived.count };
}