-- CreateTable
CREATE TABLE "AppSettings" (
    "id" INTEGER NOT NULL PRIMARY KEY DEFAULT 1 CHECK ("id" = 1),
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "currencyScale" INTEGER NOT NULL DEFAULT 2,
    "locale" TEXT NOT NULL DEFAULT 'en-IN',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "trackingStartMonth" TEXT,
    "dataRevision" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" DATETIME,
    "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" >= 1),
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Subcategory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "parentCategoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" DATETIME,
    "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" >= 1),
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Subcategory_parentCategoryId_fkey" FOREIGN KEY ("parentCategoryId") REFERENCES "Category" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PaymentMode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" >= 1),
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AccountMaster" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "accountType" TEXT NOT NULL CHECK ("accountType" IN ('SAVINGS', 'CASH', 'FD', 'MUTUAL_FUND', 'CREDIT_CARD', 'LOAN', 'EXTERNAL_INCOME', 'EXTERNAL_EXPENSE')),
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "openingBalanceMinor" BIGINT NOT NULL DEFAULT 0 CHECK ("openingBalanceMinor" BETWEEN -1000000000000 AND 1000000000000),
    "openingDate" TEXT NOT NULL,
    "currentBalanceMinor" BIGINT NOT NULL DEFAULT 0,
    "balanceAsOf" TEXT,
    "archivedAt" DATETIME,
    "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" >= 1),
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RunningAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "openingBalanceMinor" BIGINT,
    "movementMinor" BIGINT NOT NULL DEFAULT 0,
    "closingBalanceMinor" BIGINT,
    "asOfDate" TEXT,
    "projectionRevision" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "RunningAccount_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "AccountMaster" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BudgetMaster" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "month" TEXT NOT NULL,
    "totalProjectedExpenditureMinor" BIGINT NOT NULL DEFAULT 0 CHECK ("totalProjectedExpenditureMinor" >= 0),
    "currentSpendingMinor" BIGINT NOT NULL DEFAULT 0 CHECK ("currentSpendingMinor" >= 0),
    "balanceProvisioningMinor" BIGINT NOT NULL DEFAULT 0,
    "settlementPlannedMinor" BIGINT NOT NULL DEFAULT 0 CHECK ("settlementPlannedMinor" >= 0),
    "settlementUsedMinor" BIGINT NOT NULL DEFAULT 0 CHECK ("settlementUsedMinor" >= 0),
    "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" >= 1),
    "projectionRevision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BudgetDetail" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "budgetMasterId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "subcategoryId" TEXT NOT NULL,
    "planningClass" TEXT NOT NULL CHECK ("planningClass" IN ('EXPENSE', 'SAVING', 'INVESTMENT', 'LOAN_PAYMENT', 'CARD_SETTLEMENT')),
    "budgetAmountMinor" BIGINT NOT NULL DEFAULT 0 CHECK ("budgetAmountMinor" >= 0 AND "budgetAmountMinor" <= 1000000000000),
    "spendMinor" BIGINT NOT NULL DEFAULT 0 CHECK ("spendMinor" >= 0),
    "balanceMinor" BIGINT NOT NULL DEFAULT 0,
    "alertThresholdBps" INTEGER NOT NULL DEFAULT 8000 CHECK ("alertThresholdBps" BETWEEN 0 AND 10000),
    "preferredSourceAccountId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" >= 1),
    CONSTRAINT "BudgetDetail_budgetMasterId_fkey" FOREIGN KEY ("budgetMasterId") REFERENCES "BudgetMaster" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BudgetDetail_subcategoryId_fkey" FOREIGN KEY ("subcategoryId") REFERENCES "Subcategory" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BudgetDetail_preferredSourceAccountId_fkey" FOREIGN KEY ("preferredSourceAccountId") REFERENCES "AccountMaster" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL CHECK ("type" IN ('EXPENSE', 'FINANCIAL')),
    "financialKind" TEXT CHECK ("financialKind" IS NULL OR "financialKind" IN ('INCOME', 'TRANSFER', 'ATM_WITHDRAWAL', 'CARD_PAYMENT', 'BORROWING')),
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
    CONSTRAINT "Transaction_sourceAccountId_fkey" FOREIGN KEY ("sourceAccountId") REFERENCES "AccountMaster" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Transaction_destinationAccountId_fkey" FOREIGN KEY ("destinationAccountId") REFERENCES "AccountMaster" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Transaction_paymentModeId_fkey" FOREIGN KEY ("paymentModeId") REFERENCES "PaymentMode" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Transaction_subcategoryId_fkey" FOREIGN KEY ("subcategoryId") REFERENCES "Subcategory" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Transaction_budgetDetailId_fkey" FOREIGN KEY ("budgetDetailId") REFERENCES "BudgetDetail" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TransactionPosting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transactionId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "deltaMinor" BIGINT NOT NULL CHECK ("deltaMinor" <> 0 AND "deltaMinor" BETWEEN -1000000000000 AND 1000000000000),
    "component" TEXT NOT NULL DEFAULT 'AMOUNT',
    CONSTRAINT "TransactionPosting_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TransactionPosting_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "AccountMaster" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" TEXT,
    "after" TEXT,
    "reason" TEXT,
    "requestId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "routeScope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "responseBody" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Category_normalizedName_key" ON "Category"("normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "Subcategory_parentCategoryId_normalizedName_key" ON "Subcategory"("parentCategoryId", "normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentMode_normalizedName_key" ON "PaymentMode"("normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "AccountMaster_normalizedName_key" ON "AccountMaster"("normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "RunningAccount_accountId_month_key" ON "RunningAccount"("accountId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetMaster_month_key" ON "BudgetMaster"("month");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetDetail_budgetMasterId_categoryId_subcategoryId_key" ON "BudgetDetail"("budgetMasterId", "categoryId", "subcategoryId");

-- CreateIndex
CREATE INDEX "Transaction_date_idx" ON "Transaction"("date");

-- CreateIndex
CREATE INDEX "Transaction_type_financialKind_idx" ON "Transaction"("type", "financialKind");

-- CreateIndex
CREATE INDEX "Transaction_categoryId_subcategoryId_idx" ON "Transaction"("categoryId", "subcategoryId");

-- CreateIndex
CREATE INDEX "Transaction_sourceAccountId_idx" ON "Transaction"("sourceAccountId");

-- CreateIndex
CREATE INDEX "Transaction_destinationAccountId_idx" ON "Transaction"("destinationAccountId");

-- CreateIndex
CREATE INDEX "Transaction_budgetDetailId_idx" ON "Transaction"("budgetDetailId");

-- CreateIndex
CREATE INDEX "Transaction_expenseLocation_date_idx" ON "Transaction"("expenseLocation", "date");

-- CreateIndex
CREATE INDEX "TransactionPosting_accountId_idx" ON "TransactionPosting"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "TransactionPosting_transactionId_accountId_component_key" ON "TransactionPosting"("transactionId", "accountId", "component");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_idx" ON "AuditEvent"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_routeScope_key_key" ON "IdempotencyRecord"("routeScope", "key");
