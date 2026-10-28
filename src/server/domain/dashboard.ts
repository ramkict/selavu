import { assertMonth, monthBounds, todayIn } from "../lib/calendar";
import { formatMinor } from "../lib/money";
import { getBudgetByMonth } from "./budgets";
import { type Tx } from "./projections";
import { isExternal, isLiability } from "./rules";

/**
 * One server snapshot for the Dashboard. Expenses are consumption (BUD-10); budget
 * figures come from the single shared BudgetMaster; location buckets are actuals only.
 */
export async function getDashboard(tx: Tx, month: string, now: Date = new Date()) {
  assertMonth(month);
  const settings = await tx.appSettings.findUniqueOrThrow({ where: { id: 1 } });
  const today = todayIn(settings.timezone, now);
  const { start, endExclusive } = monthBounds(month);
  const inMonth = { date: { gte: start, lt: endExclusive } };

  const [budget, incomeAgg, expenseAgg, byLocation, byCategory, accounts] = await Promise.all([
    getBudgetByMonth(tx, month),
    tx.transaction.aggregate({ where: { ...inMonth, type: "FINANCIAL", financialKind: "INCOME" }, _sum: { amountMinor: true }, _count: true }),
    tx.transaction.aggregate({ where: { ...inMonth, type: "EXPENSE" }, _sum: { amountMinor: true }, _count: true }),
    tx.transaction.groupBy({ by: ["expenseLocation"], where: { ...inMonth, type: "EXPENSE" }, _sum: { amountMinor: true }, _count: true }),
    tx.transaction.groupBy({ by: ["categoryId"], where: { ...inMonth, type: "EXPENSE" }, _sum: { amountMinor: true } }),
    tx.accountMaster.findMany({ where: { archivedAt: null }, orderBy: [{ isSystem: "asc" }, { name: "asc" }] }),
  ]);

  const locationTotals = { CHE: 0n, HYD: 0n };
  const locationCounts = { CHE: 0, HYD: 0 };
  for (const row of byLocation) {
    const key = row.expenseLocation as keyof typeof locationTotals;
    locationTotals[key] += row._sum.amountMinor ?? 0n;
    locationCounts[key] += row._count;
  }

  const categories = await tx.category.findMany({ where: { id: { in: byCategory.map((c) => c.categoryId) } }, select: { id: true, name: true, color: true } });
  const categoryName = new Map(categories.map((c) => [c.id, c]));

  const monthlyByAccount = await tx.runningAccount.findMany({ where: { month } });
  const monthRow = new Map(monthlyByAccount.map((r) => [r.accountId, r]));
  const ownedAccounts = accounts.filter((a) => !isExternal(a.accountType));

  let assetsMinor = 0n;
  let liabilitiesMinor = 0n;
  for (const a of ownedAccounts) {
    if (isLiability(a.accountType)) liabilitiesMinor += a.currentBalanceMinor;
    else assetsMinor += a.currentBalanceMinor;
  }

  const expenseTotal = expenseAgg._sum.amountMinor ?? 0n;
  const incomeTotal = incomeAgg._sum.amountMinor ?? 0n;
  const alerts: { level: "info" | "warning"; message: string }[] = [];
  if (!budget) alerts.push({ level: "info", message: `No budget exists for ${month}. Actual activity is still shown.` });
  for (const d of budget?.details ?? []) {
    if (d.alert) alerts.push({ level: "warning", message: `${d.subcategoryName} has reached its alert threshold.` });
  }
  if (budget && expenseTotal > 0n && await tx.transaction.count({ where: { ...inMonth, type: "EXPENSE", budgetDetailId: null } }) > 0) {
    alerts.push({ level: "info", message: "Some expenses are unbudgeted in this month." });
  }
  for (const a of ownedAccounts) {
    if (!isLiability(a.accountType) && a.currentBalanceMinor < 0n) alerts.push({ level: "warning", message: `${a.name} has a negative balance.` });
  }

  return {
    month,
    today,
    dataRevision: settings.dataRevision,
    budget,
    metrics: {
      totalIncome: { minor: incomeTotal.toString(), formatted: formatMinor(incomeTotal), count: incomeAgg._count },
      expenses: { minor: expenseTotal.toString(), formatted: formatMinor(expenseTotal), count: expenseAgg._count },
      budgetUsed: budget ? { minor: budget.totals.budgetUsedMinor, formatted: budget.totals.formatted.budgetUsed } : null,
      remaining: budget ? { minor: budget.totals.remainingMinor, formatted: budget.totals.formatted.remaining } : null,
      totalProvisioned: budget ? { minor: budget.totals.totalProvisionedMinor, formatted: budget.totals.formatted.totalProvisioned } : null,
    },
    expensesByLocation: (["CHE", "HYD"] as const).map((code) => ({
      code,
      minor: locationTotals[code].toString(),
      formatted: formatMinor(locationTotals[code]),
      count: locationCounts[code],
    })),
    expensesByCategory: byCategory
      .map((c) => ({ categoryId: c.categoryId, name: categoryName.get(c.categoryId)?.name ?? c.categoryId, color: categoryName.get(c.categoryId)?.color ?? "#087f77", minor: (c._sum.amountMinor ?? 0n).toString(), formatted: formatMinor(c._sum.amountMinor ?? 0n) }))
      .sort((a, b) => (BigInt(b.minor) > BigInt(a.minor) ? 1 : -1)),
    accounts: ownedAccounts.map((a) => {
      const row = monthRow.get(a.id);
      return {
        id: a.id,
        name: a.name,
        accountType: a.accountType,
        isLiability: isLiability(a.accountType),
        monthOpeningMinor: row?.openingBalanceMinor?.toString() ?? null,
        monthClosingMinor: row?.closingBalanceMinor?.toString() ?? null,
        liveCurrentMinor: a.currentBalanceMinor.toString(),
        liveCurrentFormatted: formatMinor(a.currentBalanceMinor),
      };
    }),
    netWorth: {
      asOf: today,
      assetsMinor: assetsMinor.toString(),
      liabilitiesMinor: liabilitiesMinor.toString(),
      netWorthMinor: (assetsMinor - liabilitiesMinor).toString(),
      formatted: formatMinor(assetsMinor - liabilitiesMinor),
    },
    alerts,
  };
}
