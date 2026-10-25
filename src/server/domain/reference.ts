import { defaultPlanningClass } from "../catalog/catalog";
import type { Tx } from "./projections";

export async function listCategories(tx: Tx) {
  const categories = await tx.category.findMany({
    orderBy: [{ isSystem: "asc" }, { name: "asc" }],
    include: { subcategories: { orderBy: { name: "asc" } } },
  });
  return categories.map((c) => ({
    id: c.id,
    name: c.name,
    icon: c.icon,
    color: c.color,
    isSystem: c.isSystem,
    version: c.version,
    archivedAt: c.archivedAt?.toISOString() ?? null,
    subcategories: c.subcategories.map((s) => ({
      id: s.id,
      name: s.name,
      isSystem: s.isSystem,
      version: s.version,
      archivedAt: s.archivedAt?.toISOString() ?? null,
      suggestedPlanningClass: defaultPlanningClass(c.id, s.id),
    })),
  }));
}

export async function listPaymentModes(tx: Tx) {
  return tx.paymentMode.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } });
}

export async function getSettings(tx: Tx) {
  const s = await tx.appSettings.findUniqueOrThrow({ where: { id: 1 } });
  return {
    currency: s.currency,
    currencyScale: s.currencyScale,
    locale: s.locale,
    timezone: s.timezone,
    trackingStartMonth: s.trackingStartMonth,
    dataRevision: s.dataRevision,
    version: s.version,
  };
}
