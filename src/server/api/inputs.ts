import type { z } from "zod";
import { parseMinorString } from "../lib/money";
import type { TransactionDraft } from "../domain/transactions";
import type { BudgetLineInput } from "../domain/budgets";
import type { FinancialKind } from "../domain/rules";
import type { transactionBody, budgetLine } from "./schemas";

type TransactionBody = z.infer<typeof transactionBody>;
type BudgetLineBody = z.infer<typeof budgetLine>;

export function toTransactionInput(body: TransactionBody): Partial<TransactionDraft> & Pick<TransactionDraft, "type" | "date" | "amountMinor" | "sourceAccountId" | "destinationAccountId" | "categoryId" | "subcategoryId"> {
  return {
    ...body,
    financialKind: (body.financialKind ?? null) as FinancialKind | null,
    notes: body.notes ?? null,
    paymentModeId: body.paymentModeId ?? null,
    expenseLocation: body.expenseLocation ?? null,
    incomeType: body.incomeType ?? null,
    incomeSourceLabel: body.incomeSourceLabel ?? null,
    recurring: body.recurring ?? false,
    amountMinor: parseMinorString(body.amountMinor, "amountMinor"),
  };
}

export function toBudgetLines(lines: BudgetLineBody[]): BudgetLineInput[] {
  return lines.map((l) => ({ ...l, budgetAmountMinor: parseMinorString(l.budgetAmountMinor, "budgetAmountMinor", { allowZero: true }) }));
}
