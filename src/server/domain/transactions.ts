import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { notFound, semantic, staleVersion } from "../lib/errors";
import { formatMinor } from "../lib/money";
import { assertDate, monthBounds, monthOf } from "../lib/calendar";
import { cleanName } from "../lib/text";
import { audit, bumpDataRevision, refreshAccounts, refreshBudgetMonth, type Tx } from "./projections";
import {
  DEFAULT_EXPENSE_LOCATION,
  FINANCIAL_KINDS,
  buildPostings,
  endpointRuleViolation,
  type ExpenseLocation,
  type FinancialKind,
  isExternal,
} from "./rules";
import { CARD_SETTLEMENT_CATEGORY } from "../catalog/catalog";

export type TransactionDraft = {
  type: "EXPENSE" | "FINANCIAL";
  financialKind: FinancialKind | null;
  date: string;
  description: string;
  notes: string | null;
  amountMinor: bigint;
  sourceAccountId: string;
  destinationAccountId: string;
  paymentModeId: string | null;
  expenseLocation: ExpenseLocation | null;
  categoryId: string;
  subcategoryId: string;
  incomeType: string | null;
  incomeSourceLabel: string | null;
  recurring: boolean;
};

export type CommandContext = { today: string; requestId?: string };

const SYSTEM_TRANSFER_SUB = "sys_transfer";

async function validateDraft(tx: Tx, draft: TransactionDraft, ctx: CommandContext, existing?: { sourceAccountId: string; destinationAccountId: string; categoryId: string; subcategoryId: string }) {
  const fieldErrors: Record<string, string[]> = {};
  const add = (field: string, message: string) => (fieldErrors[field] = [...(fieldErrors[field] ?? []), message]);

  if (!draft.description) add("description", "Enter a description.");
  if (draft.description.length > 200) add("description", "Keep the description under 200 characters.");
  if (draft.notes && draft.notes.length > 2000) add("notes", "Notes must be under 2000 characters.");
  if (draft.date > ctx.today) add("date", "Actual transactions cannot be dated in the future.");
  if (draft.type === "EXPENSE" && draft.financialKind !== null) add("financialKind", "Expenses do not have a financial kind.");
  if (draft.type === "FINANCIAL" && draft.financialKind === null) add("financialKind", "Choose a financial kind.");
  if (draft.type === "FINANCIAL" && draft.financialKind && !(FINANCIAL_KINDS as readonly string[]).includes(draft.financialKind)) {
    add("financialKind", "Unknown financial kind.");
  }

  if (draft.type === "EXPENSE") {
  } else if (draft.expenseLocation) {
    add("expenseLocation", "Only ordinary expenses carry an expense location.");
  }
  if (draft.type === "EXPENSE" && !draft.paymentModeId) add("paymentModeId", "Select a payment mode.");
  if (draft.type === "FINANCIAL" && draft.financialKind !== "INCOME" && (draft.incomeType || draft.incomeSourceLabel || draft.recurring)) {
    add("incomeType", "Income metadata applies only to income.");
  }

  const subcategory = await tx.subcategory.findUnique({ where: { id: draft.subcategoryId }, include: { parent: true } });
  if (!subcategory || subcategory.parentCategoryId !== draft.categoryId) {
    add("subcategoryId", "Choose a subcategory that belongs to the selected category.");
  } else {
    const classificationChanged = !existing || existing.categoryId !== draft.categoryId || existing.subcategoryId !== draft.subcategoryId;
    if (classificationChanged && (subcategory.archivedAt || subcategory.parent.archivedAt)) add("subcategoryId", "Archived classifications cannot be assigned.");
    if (draft.type === "EXPENSE" && subcategory.isSystem) add("subcategoryId", "Choose a spending subcategory for an expense.");
    if (draft.financialKind === "CARD_PAYMENT" && draft.categoryId !== CARD_SETTLEMENT_CATEGORY.id) {
      add("categoryId", "Choose a card settlement line for this payment.");
    }
    if (draft.financialKind === "INCOME" && subcategory.id !== SYSTEM_TRANSFER_SUB) {
      add("subcategoryId", "Income is classified under Accounts / Transfer.");
    }
  }
  if (draft.paymentModeId) {
    const mode = await tx.paymentMode.findUnique({ where: { id: draft.paymentModeId } });
    if (!mode || !mode.active) add("paymentModeId", "Choose an active payment mode.");
  }

  const [source, destination] = await Promise.all([
    tx.accountMaster.findUnique({ where: { id: draft.sourceAccountId } }),
    tx.accountMaster.findUnique({ where: { id: draft.destinationAccountId } }),
  ]);
  if (!source) add("sourceAccountId", "Source account was not found.");
  if (!destination) add("destinationAccountId", "Destination account was not found.");
  const kind = draft.type === "EXPENSE" ? "EXPENSE" : draft.financialKind;
  if (source && destination && kind) {
    const violation = endpointRuleViolation(kind, source, destination);
    if (violation) add("destinationAccountId", violation);
    const sourceChanged = !existing || existing.sourceAccountId !== source.id;
    const destinationChanged = !existing || existing.destinationAccountId !== destination.id;
    if (sourceChanged && source.archivedAt && !isExternal(source.accountType)) add("sourceAccountId", "Archived accounts cannot receive new activity.");
    if (destinationChanged && destination.archivedAt && !isExternal(destination.accountType)) add("destinationAccountId", "Archived accounts cannot receive new activity.");
    for (const account of [source, destination]) {
      if (!isExternal(account.accountType) && draft.date < account.openingDate) {
        add(account.id === source.id ? "sourceAccountId" : "destinationAccountId", `Date is before ${account.name} opened on ${account.openingDate}.`);
      }
    }
  }

  if (Object.keys(fieldErrors).length) throw semantic("Please correct the highlighted fields.", fieldErrors);
  return { source: source!, destination: destination! };
}

const include = {
  sourceAccount: { select: { id: true, name: true, accountType: true } },
  destinationAccount: { select: { id: true, name: true, accountType: true } },
  paymentMode: { select: { id: true, name: true } },
  subcategory: { select: { id: true, name: true, parentCategoryId: true } },
  budgetDetail: { select: { id: true, planningClass: true } },
} as const;

type TransactionRecord = NonNullable<Awaited<ReturnType<typeof loadTransaction>>>;

async function loadTransaction(tx: Tx, id: string) {
  return tx.transaction.findUnique({ where: { id }, include });
}

export function serializeTransaction(t: TransactionRecord) {
  const budgetMatch = t.type !== "EXPENSE" && t.financialKind !== "CARD_PAYMENT" ? "NOT_APPLICABLE" : t.budgetDetailId ? "MATCHED" : "UNBUDGETED";
  return {
    id: t.id,
    type: t.type,
    financialKind: t.financialKind,
    date: t.date,
    description: t.description,
    notes: t.notes,
    amountMinor: t.amountMinor.toString(),
    amountFormatted: formatMinor(t.amountMinor),
    source: t.sourceAccount,
    destination: t.destinationAccount,
    paymentMode: t.paymentMode,
    expenseLocation: t.expenseLocation,
    expenseLocationLabel: t.expenseLocation === "CHE" ? "Chennai (CHE)" : t.expenseLocation === "HYD" ? "Hyderabad (HYD)" : null,
    categoryId: t.categoryId,
    subcategory: t.subcategory,
    budgetDetailId: t.budgetDetailId,
    budgetImpactMinor: t.budgetImpactMinor.toString(),
    budgetMatch,
    incomeType: t.incomeType,
    incomeSourceLabel: t.incomeSourceLabel,
    recurring: t.recurring,
    version: t.version,
  };
}

type DraftInput = Partial<TransactionDraft> & Pick<TransactionDraft, "type" | "date" | "amountMinor" | "sourceAccountId" | "destinationAccountId" | "categoryId" | "subcategoryId">;

function toDraft(input: DraftInput): TransactionDraft {
  return {
    ...input,
    date: assertDate(input.date),
    financialKind: input.financialKind ?? null,
    description: cleanName(input.description ?? ""),
    notes: input.notes?.trim() || null,
    paymentModeId: input.paymentModeId ?? null,
    expenseLocation: input.type === "EXPENSE" ? (input.expenseLocation ?? DEFAULT_EXPENSE_LOCATION) : (input.expenseLocation ?? null),
    incomeType: input.incomeType?.trim() || null,
    incomeSourceLabel: input.incomeSourceLabel?.trim() || null,
    recurring: input.recurring ?? false,
  };
}

export async function getTransaction(tx: Tx, id: string) {
  const record = await loadTransaction(tx, id);
  if (!record) throw notFound("Transaction");
  return serializeTransaction(record);
}

export async function createTransaction(tx: Tx, input: Partial<TransactionDraft> & Pick<TransactionDraft, "type" | "date" | "amountMinor" | "sourceAccountId" | "destinationAccountId" | "categoryId" | "subcategoryId">, ctx: CommandContext) {
  const draft = toDraft(input);
  const { source, destination } = await validateDraft(tx, draft, ctx);
  const created = await tx.transaction.create({
    data: {
      id: randomUUID(),
      type: draft.type,
      financialKind: draft.financialKind,
      date: draft.date,
      description: draft.description,
      notes: draft.notes,
      amountMinor: draft.amountMinor,
      sourceAccountId: source.id,
      destinationAccountId: destination.id,
      paymentModeId: draft.paymentModeId,
      expenseLocation: draft.expenseLocation,
      categoryId: draft.categoryId,
      subcategoryId: draft.subcategoryId,
      incomeType: draft.incomeType,
      incomeSourceLabel: draft.incomeSourceLabel,
      recurring: draft.recurring,
      postings: { create: buildPostings(source, destination, draft.amountMinor).map((p) => ({ ...p, id: randomUUID() })) },
    },
  });
  await refreshAccounts(tx, [source.id, destination.id], ctx.today);
  await refreshBudgetMonth(tx, monthOf(draft.date));
  await bumpDataRevision(tx);
  const record = (await loadTransaction(tx, created.id))!;
  await audit(tx, { action: "CREATE", entityType: "Transaction", entityId: created.id, after: serializeTransaction(record), requestId: ctx.requestId });
  return serializeTransaction(record);
}

export async function updateTransaction(tx: Tx, id: string, expectedVersion: number, input: Partial<TransactionDraft> & Pick<TransactionDraft, "type" | "date" | "amountMinor" | "sourceAccountId" | "destinationAccountId" | "categoryId" | "subcategoryId">, ctx: CommandContext) {
  const before = await loadTransaction(tx, id);
  if (!before) throw notFound("Transaction");
  if (before.version !== expectedVersion) throw staleVersion();
  const draft = toDraft(input);
  const { source, destination } = await validateDraft(tx, draft, ctx, before);

  const updated = await tx.transaction.updateMany({
    where: { id, version: expectedVersion },
    data: {
      type: draft.type,
      financialKind: draft.financialKind,
      date: draft.date,
      description: draft.description,
      notes: draft.notes,
      amountMinor: draft.amountMinor,
      sourceAccountId: source.id,
      destinationAccountId: destination.id,
      paymentModeId: draft.paymentModeId,
      expenseLocation: draft.expenseLocation,
      categoryId: draft.categoryId,
      subcategoryId: draft.subcategoryId,
      incomeType: draft.incomeType,
      incomeSourceLabel: draft.incomeSourceLabel,
      recurring: draft.recurring,
      budgetDetailId: null,
      budgetImpactMinor: 0n,
      version: { increment: 1 },
    },
  });
  if (updated.count !== 1) throw staleVersion();

  await tx.transactionPosting.deleteMany({ where: { transactionId: id } });
  await tx.transactionPosting.createMany({
    data: buildPostings(source, destination, draft.amountMinor).map((p) => ({ ...p, id: randomUUID(), transactionId: id })),
  });

  const accountIds = [before.sourceAccountId, before.destinationAccountId, source.id, destination.id];
  await refreshAccounts(tx, accountIds, ctx.today);
  const months = new Set([monthOf(before.date), monthOf(draft.date)]);
  for (const m of months) await refreshBudgetMonth(tx, m);
  await bumpDataRevision(tx);
  const record = (await loadTransaction(tx, id))!;
  await audit(tx, {
    action: "UPDATE",
    entityType: "Transaction",
    entityId: id,
    before: serializeTransaction(before),
    after: serializeTransaction(record),
    requestId: ctx.requestId,
  });
  return serializeTransaction(record);
}

export async function deleteTransaction(tx: Tx, id: string, expectedVersion: number, ctx: CommandContext) {
  const before = await loadTransaction(tx, id);
  if (!before) throw notFound("Transaction");
  if (before.version !== expectedVersion) throw staleVersion();
  await tx.transactionPosting.deleteMany({ where: { transactionId: id } });
  await tx.transaction.delete({ where: { id } });
  await refreshAccounts(tx, [before.sourceAccountId, before.destinationAccountId], ctx.today);
  await refreshBudgetMonth(tx, monthOf(before.date));
  await bumpDataRevision(tx);
  await audit(tx, { action: "DELETE", entityType: "Transaction", entityId: id, before: serializeTransaction(before), requestId: ctx.requestId });
}

export type TransactionListFilter = {
  month: string;
  type?: "EXPENSE" | "FINANCIAL";
  financialKind?: FinancialKind;
  categoryId?: string;
  subcategoryId?: string;
  sourceAccountId?: string;
  destinationAccountId?: string;
  accountId?: string;
  expenseLocation?: ExpenseLocation;
  search?: string;
  sort?: "date-desc" | "date-asc" | "amount-desc" | "amount-asc";
  page?: number;
  pageSize?: number;
};

export async function listTransactions(tx: Tx, filter: TransactionListFilter) {
  const { start, endExclusive } = monthBounds(filter.month);
  const pageSize = Math.min(Math.max(filter.pageSize ?? 25, 1), 100);
  const page = Math.max(filter.page ?? 1, 1);
  const where: Record<string, unknown> = { date: { gte: start, lt: endExclusive } };
  if (filter.type) where.type = filter.type;
  if (filter.financialKind) where.financialKind = filter.financialKind;
  if (filter.categoryId) where.categoryId = filter.categoryId;
  if (filter.subcategoryId) where.subcategoryId = filter.subcategoryId;
  if (filter.sourceAccountId) where.sourceAccountId = filter.sourceAccountId;
  if (filter.destinationAccountId) where.destinationAccountId = filter.destinationAccountId;
  if (filter.accountId) where.OR = [{ sourceAccountId: filter.accountId }, { destinationAccountId: filter.accountId }];
  if (filter.search?.trim()) where.description = { contains: filter.search.trim() };
  if (filter.expenseLocation) {
    where.type = "EXPENSE";
    where.expenseLocation = filter.expenseLocation;
  }
  const orderBy: Prisma.TransactionOrderByWithRelationInput[] = filter.sort === "date-asc" ? [{ date: "asc" }, { id: "asc" }]
    : filter.sort === "amount-desc" ? [{ amountMinor: "desc" }, { date: "desc" }, { id: "desc" }]
      : filter.sort === "amount-asc" ? [{ amountMinor: "asc" }, { date: "desc" }, { id: "desc" }]
        : [{ date: "desc" }, { id: "desc" }];
  const [rows, total, sum] = await Promise.all([
    tx.transaction.findMany({ where, include, orderBy, skip: (page - 1) * pageSize, take: pageSize }),
    tx.transaction.count({ where }),
    tx.transaction.aggregate({ where, _sum: { amountMinor: true } }),
  ]);
  const totalMinor = sum._sum.amountMinor ?? 0n;
  return {
    items: rows.map(serializeTransaction),
    page,
    pageSize,
    total,
    filteredTotalMinor: totalMinor.toString(),
    filteredTotalFormatted: formatMinor(totalMinor),
  };
}
