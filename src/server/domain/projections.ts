import type { Prisma } from "@/generated/prisma/client";
import { addMonths, monthBounds, monthOf } from "../lib/calendar";
import { requiredPlanningClass, isExternal, type FinancialKind } from "./rules";

export type Tx = Prisma.TransactionClient;

/**
 * Rebuilds stored account projections (AccountMaster current balance and
 * RunningAccount monthly rows) from posting facts. Rebuildable by design:
 *   currentBalance = openingBalance + sum(all postings)
 *   month opening  = openingBalance + sum(postings dated before month start)
 *   month closing  = opening + sum(postings dated in month)
 * Months after the current local month are never materialized.
 */
export async function refreshAccounts(tx: Tx, accountIds: string[], today: string) {
  const currentMonth = today.slice(0, 7);
  for (const id of [...new Set(accountIds)]) {
    const account = await tx.accountMaster.findUnique({ where: { id } });
    if (!account) continue;
    const postings = await tx.transactionPosting.findMany({
      where: { accountId: id },
      select: { deltaMinor: true, transaction: { select: { date: true } } },
    });
    const total = postings.reduce((sum, p) => sum + p.deltaMinor, 0n);
    await tx.accountMaster.update({
      where: { id },
      data: { currentBalanceMinor: account.openingBalanceMinor + total, balanceAsOf: today },
    });
    if (account.accountType === "EXTERNAL_INCOME") continue;

    const earliestSnapshot = isExternal(account.accountType)
      ? await tx.runningAccount.findFirst({ where: { accountId: id }, orderBy: { month: "asc" }, select: { month: true } })
      : null;
    const openingMonth = isExternal(account.accountType)
      ? postings.reduce((first, p) => p.transaction.date.slice(0, 7) < first ? p.transaction.date.slice(0, 7) : first, earliestSnapshot?.month && earliestSnapshot.month < currentMonth ? earliestSnapshot.month : currentMonth)
      : monthOf(account.openingDate);
    await tx.runningAccount.deleteMany({ where: { accountId: id, month: { lt: openingMonth } } });
    for (let month = openingMonth; month <= currentMonth; month = addMonths(month, 1)) {
      const { start, endExclusive } = monthBounds(month);
      let before = 0n;
      let movement = 0n;
      for (const p of postings) {
        const date = p.transaction.date;
        if (date < start) before += p.deltaMinor;
        else if (date < endExclusive) movement += p.deltaMinor;
      }
      const opening = account.openingBalanceMinor + before;
      const closing = opening + movement;
      const asOfDate = month === currentMonth ? today : monthEndDate(month);
      await tx.runningAccount.upsert({
        where: { accountId_month: { accountId: id, month } },
        create: { accountId: id, month, openingBalanceMinor: opening, movementMinor: movement, closingBalanceMinor: closing, asOfDate, projectionRevision: 1 },
        update: { openingBalanceMinor: opening, movementMinor: movement, closingBalanceMinor: closing, asOfDate, projectionRevision: { increment: 1 } },
      });
    }
  }
}

function monthEndDate(month: string): string {
  const { endExclusive } = monthBounds(month);
  const d = new Date(`${endExclusive}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Rematches budgetable transactions for one month against that month's shared
 * BudgetMaster and refreshes detail and master totals. No-op when no budget exists.
 */
export async function refreshBudgetMonth(tx: Tx, month: string) {
  const { start, endExclusive } = monthBounds(month);
  const master = await tx.budgetMaster.findUnique({ where: { month }, include: { details: true } });
  const txns = await tx.transaction.findMany({
    where: { date: { gte: start, lt: endExclusive } },
    select: { id: true, type: true, financialKind: true, amountMinor: true, categoryId: true, subcategoryId: true, budgetDetailId: true, budgetImpactMinor: true },
  });

  const spendByDetail = new Map<string, bigint>();
  let currentSpending = 0n;
  for (const t of txns) {
    const required = requiredPlanningClass(t.type as "EXPENSE" | "FINANCIAL", (t.financialKind ?? null) as FinancialKind | null, t.categoryId);
    const detail = master && required
      ? master.details.find((d) => d.categoryId === t.categoryId && d.subcategoryId === t.subcategoryId && d.planningClass === required)
      : undefined;
    const nextDetailId = detail?.id ?? null;
    const nextImpact = detail ? t.amountMinor : 0n;
    if (nextDetailId !== t.budgetDetailId || nextImpact !== t.budgetImpactMinor) {
      await tx.transaction.update({ where: { id: t.id }, data: { budgetDetailId: nextDetailId, budgetImpactMinor: nextImpact } });
    }
    if (nextDetailId) spendByDetail.set(nextDetailId, (spendByDetail.get(nextDetailId) ?? 0n) + nextImpact);
    if (t.type === "EXPENSE") currentSpending += t.amountMinor;
  }

  if (!master) return;

  let totalProvisioned = 0n;
  let used = 0n;
  let settlementPlanned = 0n;
  let settlementUsed = 0n;
  for (const d of master.details) {
    const spend = spendByDetail.get(d.id) ?? 0n;
    await tx.budgetDetail.update({ where: { id: d.id }, data: { spendMinor: spend, balanceMinor: d.budgetAmountMinor - spend } });
    if (d.planningClass === "CARD_SETTLEMENT") {
      settlementPlanned += d.budgetAmountMinor;
      settlementUsed += spend;
    } else {
      totalProvisioned += d.budgetAmountMinor;
      used += spend;
    }
  }
  await tx.budgetMaster.update({
    where: { id: master.id },
    data: {
      totalProjectedExpenditureMinor: totalProvisioned,
      currentSpendingMinor: currentSpending,
      balanceProvisioningMinor: totalProvisioned - used,
      settlementPlannedMinor: settlementPlanned,
      settlementUsedMinor: settlementUsed,
      projectionRevision: { increment: 1 },
    },
  });
}

export async function bumpDataRevision(tx: Tx): Promise<number> {
  const settings = await tx.appSettings.update({ where: { id: 1 }, data: { dataRevision: { increment: 1 } }, select: { dataRevision: true } });
  return settings.dataRevision;
}

export async function audit(
  tx: Tx,
  event: { action: string; entityType: string; entityId: string; before?: unknown; after?: unknown; reason?: string; requestId?: string },
) {
  await tx.auditEvent.create({
    data: {
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      before: event.before === undefined ? null : JSON.stringify(event.before, bigintReplacer),
      after: event.after === undefined ? null : JSON.stringify(event.after, bigintReplacer),
      reason: event.reason ?? null,
      requestId: event.requestId ?? null,
    },
  });
}

export const bigintReplacer = (_key: string, value: unknown) => (typeof value === "bigint" ? value.toString() : value);
