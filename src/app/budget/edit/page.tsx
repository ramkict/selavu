import Link from "next/link";
import { getDb } from "@/server/db";
import { getBudgetByMonth } from "@/server/domain/budgets";
import { getSettings, listCategories } from "@/server/domain/reference";
import { currentMonthIn, isValidMonth } from "@/server/lib/calendar";
import { minorToRupeeInput } from "@/server/lib/money";
import { BudgetForm } from "@/components/BudgetForm";

export const dynamic = "force-dynamic";

export default async function EditBudgetPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const db = await getDb();
  const { month: requested } = await searchParams;
  const { month, budget, categories } = await db.$transaction(async (tx) => {
    const settings = await getSettings(tx);
    const m = requested && isValidMonth(requested) ? requested : currentMonthIn(settings.timezone);
    return { month: m, budget: await getBudgetByMonth(tx, m), categories: await listCategories(tx) };
  });

  if (!budget) {
    return (
      <div className="card">
        <p>No budget exists for {month}, so there are no planned amounts to edit.</p>
        <Link href={`/budget/new?month=${month}`}>Create the budget</Link>
      </div>
    );
  }

  const active = categories
    .filter((c) => !c.isSystem && !c.archivedAt)
    .map((c) => ({
      id: c.id,
      name: c.name,
      subcategories: c.subcategories
        .filter((s) => !s.isSystem && !s.archivedAt)
        .map((s) => ({ id: s.id, name: s.name, suggestedPlanningClass: s.suggestedPlanningClass })),
    }));
  const amounts = Object.fromEntries(
    budget.details.map((d) => [d.subcategoryId, { rupees: minorToRupeeInput(d.budgetAmountMinor), planningClass: d.planningClass }]),
  );
  return <BudgetForm month={month} categories={active} existing={{ id: budget.id, version: budget.version, amounts }} />;
}
