import type { Tx } from "./projections";
import { addMonths, monthBounds } from "../lib/calendar";

export async function getReports(tx: Tx, month: string, filters: { sourceAccountId?: string; expenseLocation?: "CHE" | "HYD" } = {}) {
  const firstMonth = addMonths(month, -5);
  const { start } = monthBounds(firstMonth);
  const { endExclusive } = monthBounds(addMonths(month, 1));
  const where = {
    type: "EXPENSE",
    date: { gte: start, lt: endExclusive },
    ...(filters.sourceAccountId ? { sourceAccountId: filters.sourceAccountId } : {}),
    ...(filters.expenseLocation ? { expenseLocation: filters.expenseLocation } : {}),
  };
  const [transactions, categories, budget, sourceAccounts] = await Promise.all([
    tx.transaction.findMany({
      where,
      select: { amountMinor: true, date: true, categoryId: true, expenseLocation: true },
      orderBy: { date: "asc" },
    }),
    tx.category.findMany({ where: { isSystem: false }, select: { id: true, name: true, color: true } }),
    tx.budgetMaster.findUnique({ where: { month }, include: { details: true } }),
    tx.accountMaster.findMany({
      where: { accountType: { in: ["SAVINGS", "CASH", "CREDIT_CARD"] } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const selected = transactions.filter((transaction) => transaction.date.startsWith(month));
  const daysInMonth = new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate();
  const categoryRows = categories.map((category) => {
    const actualMinor = selected
      .filter((transaction) => transaction.categoryId === category.id)
      .reduce((sum, transaction) => sum + transaction.amountMinor, 0n);
    const plannedMinor = budget?.details
      .filter((detail) => detail.categoryId === category.id && detail.planningClass === "EXPENSE")
      .reduce((sum, detail) => sum + detail.budgetAmountMinor, 0n) ?? 0n;
    return { ...category, actualMinor: actualMinor.toString(), plannedMinor: plannedMinor.toString() };
  }).filter((category) => BigInt(category.actualMinor) > 0n || BigInt(category.plannedMinor) > 0n)
    .sort((first, second) => Number(BigInt(second.actualMinor) - BigInt(first.actualMinor)));

  let cumulative = 0n;
  const daily = Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1;
    const dayString = String(day).padStart(2, "0");
    cumulative += selected
      .filter((transaction) => transaction.date.slice(-2) === dayString)
      .reduce((sum, transaction) => sum + transaction.amountMinor, 0n);
    return { day, cumulativeMinor: cumulative.toString() };
  });

  const trend = Array.from({ length: 6 }, (_, index) => {
    const trendMonth = addMonths(firstMonth, index);
    const total = transactions
      .filter((transaction) => transaction.date.startsWith(trendMonth))
      .reduce((sum, transaction) => sum + transaction.amountMinor, 0n);
    return { month: trendMonth, totalMinor: total.toString() };
  });
  const locationTotals = (["CHE", "HYD"] as const).map((location) => ({
    location,
    totalMinor: selected
      .filter((transaction) => transaction.expenseLocation === location)
      .reduce((sum, transaction) => sum + transaction.amountMinor, 0n)
      .toString(),
    count: selected.filter((transaction) => transaction.expenseLocation === location).length,
  }));
  const totalMinor = selected.reduce((sum, transaction) => sum + transaction.amountMinor, 0n);

  return {
    month,
    sourceAccountId: filters.sourceAccountId ?? "",
    expenseLocation: filters.expenseLocation ?? "",
    categories: categoryRows,
    daily,
    trend,
    locationTotals,
    sourceAccounts,
    totalMinor: totalMinor.toString(),
    totalCount: selected.length,
    plannedMinor: (budget?.details
      .filter((detail) => detail.planningClass === "EXPENSE")
      .reduce((sum, detail) => sum + detail.budgetAmountMinor, 0n) ?? 0n).toString(),
  };
}