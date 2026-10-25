import { z } from "zod";
import { EXPENSE_LOCATIONS, FINANCIAL_KINDS, PLANNING_CLASSES, USER_ACCOUNT_TYPES } from "../domain/rules";
import { DomainError } from "../lib/errors";

const id = z.string().min(1).max(64);
const minorString = z.string().regex(/^\d{1,13}$/, "Send integer paise as a digit string.");
const signedMinorString = z.string().regex(/^-?\d{1,13}$/, "Send integer paise as a digit string.");
const month = z.string().regex(/^\d{4}-\d{2}$/, "Use YYYY-MM.");

export const transactionBody = z.strictObject({
  type: z.enum(["EXPENSE", "FINANCIAL"]),
  financialKind: z.enum(FINANCIAL_KINDS).nullable().optional(),
  date: z.string().max(10),
  description: z.string().max(400),
  notes: z.string().max(4000).nullable().optional(),
  amountMinor: minorString,
  sourceAccountId: id,
  destinationAccountId: id,
  paymentModeId: id.nullable().optional(),
  expenseLocation: z.enum(EXPENSE_LOCATIONS).nullable().optional(),
  categoryId: id,
  subcategoryId: id,
  incomeType: z.string().max(40).nullable().optional(),
  incomeSourceLabel: z.string().max(120).nullable().optional(),
  recurring: z.boolean().optional(),
});

export const transactionPatchBody = transactionBody.extend({ expectedVersion: z.number().int().positive() });

export const transactionListQuery = z.strictObject({
  month,
  type: z.enum(["EXPENSE", "FINANCIAL"]).optional(),
  financialKind: z.enum(FINANCIAL_KINDS).optional(),
  categoryId: id.optional(),
  subcategoryId: id.optional(),
  sourceAccountId: id.optional(),
  destinationAccountId: id.optional(),
  accountId: id.optional(),
  expenseLocation: z.enum(EXPENSE_LOCATIONS).optional(),
  search: z.string().max(120).optional(),
  sort: z.enum(["date-desc", "date-asc", "amount-desc", "amount-asc"]).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

export const budgetLine = z.strictObject({
  categoryId: id,
  subcategoryId: id,
  planningClass: z.enum(PLANNING_CLASSES),
  budgetAmountMinor: minorString,
  alertThresholdBps: z.number().int().min(0).max(10000),
});

export const budgetCreateBody = z.strictObject({ month, lines: z.array(budgetLine).min(1).max(500) });
export const budgetPatchBody = z.strictObject({
  expectedVersion: z.number().int().positive(),
  lines: z.array(budgetLine).min(1).max(500),
});

export const accountCreateBody = z.strictObject({
  name: z.string().min(1).max(80),
  accountType: z.enum(USER_ACCOUNT_TYPES),
  openingBalanceMinor: signedMinorString,
  openingDate: z.string().max(10),
});

export const accountPatchBody = z.strictObject({
  expectedVersion: z.number().int().positive(),
  name: z.string().min(1).max(80).optional(),
  accountType: z.enum(USER_ACCOUNT_TYPES).optional(),
  openingBalanceMinor: signedMinorString.optional(),
  openingDate: z.string().max(10).optional(),
  archived: z.boolean().optional(),
});

export const categoryCreateBody = z.strictObject({
  name: z.string().min(1).max(80),
  icon: z.string().min(1).max(40),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

export const categoryPatchBody = z.strictObject({
  expectedVersion: z.number().int().positive(),
  name: z.string().min(1).max(80).optional(),
  icon: z.string().min(1).max(40).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  archived: z.boolean().optional(),
}).refine((value) => value.name !== undefined || value.icon !== undefined || value.color !== undefined || value.archived !== undefined);

export const subcategoryCreateBody = z.strictObject({
  parentCategoryId: id,
  name: z.string().min(1).max(80),
});

export const subcategoryPatchBody = z.strictObject({
  expectedVersion: z.number().int().positive(),
  name: z.string().min(1).max(80).optional(),
  archived: z.boolean().optional(),
}).refine((value) => value.name !== undefined || value.archived !== undefined);

export const configuredMonthCreateBody = z.strictObject({ month });

/** Parses a body with a strict schema, mapping Zod issues to field errors (422 semantic / 400 malformed). */
export function parseBody<T extends z.ZodType>(schema: T, raw: unknown): z.infer<T> {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of result.error.issues) {
    const field = issue.path.length ? String(issue.path[0]) : "_form";
    fieldErrors[field] = [...(fieldErrors[field] ?? []), issue.message];
  }
  throw new DomainError(400, "MALFORMED_INPUT", "Request body is not valid.", fieldErrors);
}

export function parseQuery<T extends z.ZodType>(schema: T, params: URLSearchParams): z.infer<T> {
  return parseBody(schema, Object.fromEntries(params.entries()));
}
