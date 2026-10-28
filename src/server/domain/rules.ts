export const OWNED_ASSET_TYPES = ["SAVINGS", "CASH", "FD", "MUTUAL_FUND"] as const;
export const LIABILITY_TYPES = ["CREDIT_CARD", "LOAN"] as const;
export const EXTERNAL_TYPES = ["EXTERNAL_INCOME", "EXTERNAL_EXPENSE"] as const;
export const ACCOUNT_TYPES = [...OWNED_ASSET_TYPES, ...LIABILITY_TYPES, ...EXTERNAL_TYPES] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/** Types a user may choose. CASH is reserved for the generic "Cash In Hand" account, which always exists. */
export const USER_ACCOUNT_TYPES = ["SAVINGS", "FD", "MUTUAL_FUND", "CREDIT_CARD", "LOAN"] as const;

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  SAVINGS: "Savings",
  CASH: "Cash In Hand",
  FD: "Deposits (FD)",
  MUTUAL_FUND: "Mutual Fund",
  CREDIT_CARD: "Credit Card",
  LOAN: "Loan",
  EXTERNAL_INCOME: "Income (external)",
  EXTERNAL_EXPENSE: "Expense (external)",
};

/** Credit-card style and loan balances are positive debt; negative means credit available. */
export const isLiability = (type: string) => (LIABILITY_TYPES as readonly string[]).includes(type);
/** External endpoints (Income, Expense) are excluded from owned balances and net worth. */
export const isExternal = (type: string) => (EXTERNAL_TYPES as readonly string[]).includes(type);

export const FINANCIAL_KINDS = ["INCOME", "TRANSFER", "ATM_WITHDRAWAL", "CARD_PAYMENT", "BORROWING", "INTEREST_ACCRUAL", "LOAN_PAYMENT"] as const;
export type FinancialKind = (typeof FINANCIAL_KINDS)[number];
export const EXPENSE_LOCATIONS = ["CHE", "HYD"] as const;
export type ExpenseLocation = (typeof EXPENSE_LOCATIONS)[number];
export const DEFAULT_EXPENSE_LOCATION: ExpenseLocation = "CHE";
export const CARD_SETTLEMENT_CATEGORY_ID = "sys_card_settlement";

export const PLANNING_CLASSES = ["EXPENSE", "CARD_SETTLEMENT", "SAVING"] as const;
export type PlanningClass = (typeof PLANNING_CLASSES)[number];

export const EXPENSE_LOCATION_LABELS: Record<ExpenseLocation, string> = { CHE: "Chennai", HYD: "Hyderabad" };

type Endpoint = { id: string; accountType: string; openingDate: string; archivedAt?: Date | null };

const SPEND_CAPABLE: readonly string[] = ["SAVINGS", "CASH", "CREDIT_CARD"];
const CARD_PAYMENT_SOURCES: readonly string[] = ["SAVINGS", "CASH"];
const isAssetType = (type: string) => (OWNED_ASSET_TYPES as readonly string[]).includes(type);

/**
 * Returns an error message when the endpoint pair is not allowed for the kind.
 * Ordinary expenses are EXPENSE (no financialKind) and use the protected Expense endpoint.
 */
export function endpointRuleViolation(kind: FinancialKind | "EXPENSE", src: Endpoint, dst: Endpoint): string | null {
  const s = src.accountType;
  const d = dst.accountType;
  switch (kind) {
    case "EXPENSE":
      if (!SPEND_CAPABLE.includes(s)) return "Expenses must be paid from Savings, Cash In Hand, or a Credit Card.";
      if (d !== "EXTERNAL_EXPENSE") return "Expense destination must be the external Expense account.";
      return null;
    case "INCOME":
      if (s !== "EXTERNAL_INCOME") return "Income source must be the external Income account.";
      if (!["SAVINGS", "CASH"].includes(d)) return "Income must be received into Savings or Cash In Hand.";
      return null;
    case "TRANSFER":
      if (!isAssetType(s) || !isAssetType(d)) return "Transfers move money between owned asset accounts.";
      return null;
    case "ATM_WITHDRAWAL":
      if (s !== "SAVINGS" || d !== "CASH") return "ATM withdrawals move money from Savings to Cash In Hand.";
      return null;
    case "CARD_PAYMENT":
      if (!CARD_PAYMENT_SOURCES.includes(s) || d !== "CREDIT_CARD") return "Card payments go from Savings or Cash In Hand to a Credit Card.";
      return null;
    case "BORROWING":
      if (!["CREDIT_CARD", "LOAN"].includes(s) || !isAssetType(d)) return "Borrowing draws from a Credit Card or Loan into an asset account.";
      return null;
    case "INTEREST_ACCRUAL":
      if (s !== "LOAN" || d !== "EXTERNAL_EXPENSE") return "Interest accrual goes from a Loan to Expenses.";
      return null;
    case "LOAN_PAYMENT":
      if (!["SAVINGS", "CASH"].includes(s) || d !== "LOAN") return "Loan payments go from Savings or Cash In Hand to a Loan.";
      return null;
  }
}

/**
 * ACC-08 posting signs. Assets gain on inflow; liabilities (debt) rise when they
 * are drawn and fall when repaid. External endpoints follow the same flow convention.
 */
export function buildPostings(src: { id: string; accountType: string }, dst: { id: string; accountType: string }, amountMinor: bigint) {
  const sourceDelta = isLiability(src.accountType) ? amountMinor : -amountMinor;
  const destinationDelta = isLiability(dst.accountType) ? -amountMinor : amountMinor;
  return [
    { accountId: src.id, deltaMinor: sourceDelta, component: "AMOUNT" },
    { accountId: dst.id, deltaMinor: destinationDelta, component: "AMOUNT" },
  ];
}

/** Budget lane for a transaction, or null when it does not consume a provision. */
export function requiredPlanningClass(type: "EXPENSE" | "FINANCIAL", kind: FinancialKind | null, categoryId?: string): PlanningClass | null {
  if (type === "EXPENSE") return "EXPENSE";
  if (kind === "CARD_PAYMENT") return "CARD_SETTLEMENT";
  if (kind === "TRANSFER" && categoryId === "savings_investments") return "SAVING";
  if (kind === "LOAN_PAYMENT") return "EXPENSE";
  return null;
}

/** Owned asset/liability sign class used to decide whether an account type change is compatible. */
export const signClass = (type: string) => (isLiability(type) ? "LIABILITY" : "ASSET");
