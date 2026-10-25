import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { conflict, notFound, semantic, staleVersion } from "../lib/errors";
import { formatMinor } from "../lib/money";
import { assertMonth } from "../lib/calendar";
import { audit, bumpDataRevision, refreshBudgetMonth, type Tx } from "./projections";
import { PLANNING_CLASSES, type PlanningClass } from "./rules";

export type BudgetLineInput = {
  categoryId: string;
  subcategoryId: string;
  planningClass: PlanningClass;
  budgetAmountMinor: bigint;
  alertThresholdBps: number;
};

export type CommandContext = { today: string; requestId?: string };

/**
 * Every active non-system subcategory must be reviewed explicitly, including zero.
 * Unknown, duplicate, or missing children are rejected so a plan cannot be saved by omission.
 */
async function validateLines(tx: Tx, lines: BudgetLineInput[]) {
  const children = await tx.subcategory.findMany({
    where: { isSystem: false, archivedAt: null, parent: { archivedAt: null, isSystem: false } },
    select: { id: true, parentCategoryId: true },
  });
  const expected = new Map(children.map((c) => [`${c.parentCategoryId}/${c.id}`, true]));
  const seen = new Set<string>();
  const fieldErrors: Record<string, string[]> = {};
  for (const line of lines) {
    const key = `${line.categoryId}/${line.subcategoryId}`;
    if (!expected.has(key)) {
      fieldErrors[key] = ["Not an active catalog subcategory."];
      continue;
    }
    if (seen.has(key)) fieldErrors[key] = ["Listed more than once."];
    seen.add(key);
    if (!(PLANNING_CLASSES as readonly string[]).includes(line.planningClass)) fieldErrors[key] = ["Choose regular spending or card settlement."];
    if (!Number.isInteger(line.alertThresholdBps) || line.alertThresholdBps < 0 || line.alertThresholdBps > 10000) {
      fieldErrors[key] = ["Alert threshold must be between 0 and 10000 basis points."];
    }
    if (line.budgetAmountMinor < 0n) fieldErrors[key] = ["Planned amount cannot be negative."];
  }
  const missing = [...expected.keys()].filter((k) => !seen.has(k));
  if (missing.length) fieldErrors._missing = [`${missing.length} active subcategories were not reviewed.`];
  if (Object.keys(fieldErrors).length) throw semantic("Review every active subcategory before saving the budget.", fieldErrors);
}

const budgetInclude = {
  details: {
    include: { subcategory: { select: { id: true, name: true, parentCategoryId: true, parent: { select: { name: true, icon: true, color: true } } } } },
    orderBy: [{ categoryId: "asc" }, { subcategoryId: "asc" }],
  },
} satisfies Prisma.BudgetMasterInclude;

type BudgetRecord = NonNullable<Awaited<ReturnType<typeof loadBudget>>>;

async function loadBudget(tx: Tx, where: { id: string } | { month: string }) {
  return tx.budgetMaster.findUnique({ where, include: budgetInclude });
}

export function serializeBudget(b: BudgetRecord) {
  const used = b.details.filter((d) => d.planningClass !== "CARD_SETTLEMENT").reduce((s, d) => s + d.spendMinor, 0n);
  return {
    id: b.id,
    month: b.month,
    version: b.version,
    projectionRevision: b.projectionRevision,
    totals: {
      totalProvisionedMinor: b.totalProjectedExpenditureMinor.toString(),
      budgetUsedMinor: used.toString(),
      remainingMinor: b.balanceProvisioningMinor.toString(),
      currentSpendingMinor: b.currentSpendingMinor.toString(),
      settlementPlannedMinor: b.settlementPlannedMinor.toString(),
      settlementUsedMinor: b.settlementUsedMinor.toString(),
      formatted: {
        totalProvisioned: formatMinor(b.totalProjectedExpenditureMinor),
        budgetUsed: formatMinor(used),
        remaining: formatMinor(b.balanceProvisioningMinor),
        currentSpending: formatMinor(b.currentSpendingMinor),
      },
    },
    details: b.details.map((d) => {
      const utilizationBps = d.budgetAmountMinor === 0n ? null : Number((d.spendMinor * 10000n) / d.budgetAmountMinor);
      return {
        id: d.id,
        categoryId: d.categoryId,
        subcategoryId: d.subcategoryId,
        subcategoryName: d.subcategory.name,
        categoryName: d.subcategory.parent.name,
        planningClass: d.planningClass,
        budgetAmountMinor: d.budgetAmountMinor.toString(),
        spendMinor: d.spendMinor.toString(),
        balanceMinor: d.balanceMinor.toString(),
        alertThresholdBps: d.alertThresholdBps,
        utilizationBps,
        alert: utilizationBps !== null && utilizationBps >= d.alertThresholdBps,
        version: d.version,
      };
    }),
  };
}

export async function getBudgetByMonth(tx: Tx, month: string) {
  assertMonth(month);
  const b = await loadBudget(tx, { month });
  return b ? serializeBudget(b) : null;
}

export async function getBudgetById(tx: Tx, id: string) {
  const b = await loadBudget(tx, { id });
  if (!b) throw notFound("Budget");
  return serializeBudget(b);
}

export async function createBudget(tx: Tx, input: { month: string; lines: BudgetLineInput[] }, ctx: CommandContext) {
  assertMonth(input.month);
  const existing = await tx.budgetMaster.findUnique({ where: { month: input.month }, select: { id: true } });
  if (existing) throw conflict(`A budget already exists for ${input.month}. Open it instead of creating another.`);
  await validateLines(tx, input.lines);

  const master = await tx.budgetMaster.create({
    data: {
      id: randomUUID(),
      month: input.month,
      details: {
        create: input.lines.map((l) => ({
          id: randomUUID(),
          categoryId: l.categoryId,
          subcategoryId: l.subcategoryId,
          planningClass: l.planningClass,
          budgetAmountMinor: l.budgetAmountMinor,
          alertThresholdBps: l.alertThresholdBps,
        })),
      },
    },
  });
  await refreshBudgetMonth(tx, input.month);
  await bumpDataRevision(tx);
  const created = (await loadBudget(tx, { id: master.id }))!;
  await audit(tx, { action: "CREATE", entityType: "BudgetMaster", entityId: master.id, after: { month: input.month, lines: input.lines.length }, requestId: ctx.requestId });
  return serializeBudget(created);
}

export async function updateBudget(tx: Tx, id: string, expectedVersion: number, input: { lines: BudgetLineInput[] }, ctx: CommandContext) {
  const before = await loadBudget(tx, { id });
  if (!before) throw notFound("Budget");
  if (before.version !== expectedVersion) throw staleVersion();
  await validateLines(tx, input.lines);

  const bumped = await tx.budgetMaster.updateMany({ where: { id, version: expectedVersion }, data: { version: { increment: 1 } } });
  if (bumped.count !== 1) throw staleVersion();
  for (const line of input.lines) {
    const detail = before.details.find((d) => d.categoryId === line.categoryId && d.subcategoryId === line.subcategoryId);
    const data = { planningClass: line.planningClass, budgetAmountMinor: line.budgetAmountMinor, alertThresholdBps: line.alertThresholdBps };
    if (detail) {
      await tx.budgetDetail.update({ where: { id: detail.id }, data: { ...data, version: { increment: 1 } } });
    } else {
      await tx.budgetDetail.create({ data: { ...data, id: randomUUID(), budgetMasterId: id, categoryId: line.categoryId, subcategoryId: line.subcategoryId } });
    }
  }
  await refreshBudgetMonth(tx, before.month);
  await bumpDataRevision(tx);
  const after = (await loadBudget(tx, { id }))!;
  await audit(tx, { action: "UPDATE", entityType: "BudgetMaster", entityId: id, before: serializeBudget(before).totals, after: serializeBudget(after).totals, requestId: ctx.requestId });
  return serializeBudget(after);
}

/** Deletes the month's plan. Transaction facts, postings, and balances are preserved; only detail links are cleared. */
export async function deleteBudget(tx: Tx, id: string, expectedVersion: number, ctx: CommandContext) {
  const before = await loadBudget(tx, { id });
  if (!before) throw notFound("Budget");
  if (before.version !== expectedVersion) throw staleVersion();
  const detailIds = before.details.map((d) => d.id);
  await tx.transaction.updateMany({ where: { budgetDetailId: { in: detailIds } }, data: { budgetDetailId: null, budgetImpactMinor: 0n } });
  await tx.budgetMaster.delete({ where: { id } });
  await bumpDataRevision(tx);
  await audit(tx, { action: "DELETE", entityType: "BudgetMaster", entityId: id, before: { month: before.month }, requestId: ctx.requestId });
}
