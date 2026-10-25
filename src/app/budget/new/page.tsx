import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/server/db";
import { listCategories, getSettings } from "@/server/domain/reference";
import { getBudgetByMonth } from "@/server/domain/budgets";
import { currentMonthIn, isValidMonth } from "@/server/lib/calendar";
import { BudgetForm } from "@/components/BudgetForm";
import { CARD_SETTLEMENT_CATEGORY } from "@/server/catalog/catalog";

export const dynamic = "force-dynamic";

export default async function NewBudgetPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const db = await getDb();
  const { month: requested } = await searchParams;
  const { month, existing, categories } = await db.$transaction(async (tx) => {
    const settings = await getSettings(tx);
    const m = requested && isValidMonth(requested) ? requested : currentMonthIn(settings.timezone);
    return { month: m, existing: await getBudgetByMonth(tx, m), categories: await listCategories(tx) };
  });
  if (!isValidMonth(month)) notFound();
  if (existing) {
    return (
      <div className="card">
        <p>A budget already exists for {month}. Only one shared budget is allowed per month.</p>
        <Link href={`/budget?month=${month}`}>Open the existing budget</Link>
      </div>
    );
  }
  const active = categories
    .filter((c) => (!c.isSystem && !c.archivedAt) || c.id === CARD_SETTLEMENT_CATEGORY.id)
    .map((c) => ({
      id: c.id,
      name: c.name,
      subcategories: c.subcategories
        .filter((s) => (!s.isSystem && !s.archivedAt) || c.id === CARD_SETTLEMENT_CATEGORY.id)
        .map((s) => ({ id: s.id, name: s.name, suggestedPlanningClass: s.suggestedPlanningClass })),
    }));
  return <BudgetForm month={month} categories={active} />;
}
