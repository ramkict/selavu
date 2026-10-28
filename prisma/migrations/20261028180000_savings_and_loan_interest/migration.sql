PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;

CREATE TABLE "new_Transaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL CHECK ("type" IN ('EXPENSE', 'FINANCIAL')),
    "financialKind" TEXT CHECK ("financialKind" IS NULL OR "financialKind" IN ('INCOME', 'TRANSFER', 'ATM_WITHDRAWAL', 'CARD_PAYMENT', 'BORROWING', 'INTEREST_ACCRUAL', 'LOAN_PAYMENT')),
    "date" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "notes" TEXT,
    "amountMinor" BIGINT NOT NULL CHECK ("amountMinor" > 0 AND "amountMinor" <= 1000000000000),
    "sourceAccountId" TEXT NOT NULL,
    "destinationAccountId" TEXT NOT NULL,
    "paymentModeId" TEXT,
    "expenseLocation" TEXT CHECK ("expenseLocation" IS NULL OR "expenseLocation" IN ('CHE', 'HYD')),
    "categoryId" TEXT NOT NULL,
    "subcategoryId" TEXT NOT NULL,
    "budgetDetailId" TEXT,
    "budgetImpactMinor" BIGINT NOT NULL DEFAULT 0 CHECK ("budgetImpactMinor" >= 0),
    "incomeType" TEXT,
    "incomeSourceLabel" TEXT,
    "recurring" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" >= 1),
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Transaction_kind_matches_type" CHECK (("type" = 'EXPENSE' AND "financialKind" IS NULL) OR ("type" = 'FINANCIAL' AND "financialKind" IS NOT NULL)),
    CONSTRAINT "Transaction_distinct_endpoints" CHECK ("sourceAccountId" <> "destinationAccountId"),
    CONSTRAINT "Transaction_expense_has_location" CHECK ("type" <> 'EXPENSE' OR "expenseLocation" IS NOT NULL),
    FOREIGN KEY ("sourceAccountId") REFERENCES "AccountMaster" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    FOREIGN KEY ("destinationAccountId") REFERENCES "AccountMaster" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    FOREIGN KEY ("paymentModeId") REFERENCES "PaymentMode" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    FOREIGN KEY ("subcategoryId") REFERENCES "Subcategory" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    FOREIGN KEY ("budgetDetailId") REFERENCES "BudgetDetail" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Transaction" SELECT * FROM "Transaction";
DROP TABLE "Transaction";
ALTER TABLE "new_Transaction" RENAME TO "Transaction";
CREATE INDEX "Transaction_date_idx" ON "Transaction"("date");
CREATE INDEX "Transaction_type_financialKind_idx" ON "Transaction"("type", "financialKind");
CREATE INDEX "Transaction_categoryId_subcategoryId_idx" ON "Transaction"("categoryId", "subcategoryId");
CREATE INDEX "Transaction_sourceAccountId_idx" ON "Transaction"("sourceAccountId");
CREATE INDEX "Transaction_destinationAccountId_idx" ON "Transaction"("destinationAccountId");
CREATE INDEX "Transaction_budgetDetailId_idx" ON "Transaction"("budgetDetailId");
CREATE INDEX "Transaction_expenseLocation_date_idx" ON "Transaction"("expenseLocation", "date");

INSERT OR IGNORE INTO "Category" ("id", "name", "normalizedName", "icon", "color", "updatedAt")
VALUES ('savings_investments', 'Savings and Investments', 'savings and investments', 'piggy-bank', '#087f77', CURRENT_TIMESTAMP);
INSERT OR IGNORE INTO "Subcategory" ("id", "parentCategoryId", "name", "normalizedName", "updatedAt") VALUES
('mutual_funds', 'savings_investments', 'Mutual Funds', 'mutual funds', CURRENT_TIMESTAMP),
('kids_savings', 'savings_investments', 'Kids Savings Account', 'kids savings account', CURRENT_TIMESTAMP),
('fixed_deposits', 'savings_investments', 'Fixed Deposit', 'fixed deposit', CURRENT_TIMESTAMP);

COMMIT;
PRAGMA foreign_keys=ON;
PRAGMA foreign_key_check;