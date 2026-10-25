-- Collapse legacy savings, investment, and loan-payment classes into the shared spending lane.
UPDATE "BudgetDetail"
SET "planningClass" = 'EXPENSE'
WHERE "planningClass" IN ('SAVING', 'INVESTMENT', 'LOAN_PAYMENT');

-- Rebuild links after class normalization so existing transactions remain matched.
UPDATE "Transaction"
SET
  "budgetDetailId" = (
    SELECT detail."id"
    FROM "BudgetDetail" AS detail
    INNER JOIN "BudgetMaster" AS budget ON budget."id" = detail."budgetMasterId"
    WHERE budget."month" = substr("Transaction"."date", 1, 7)
      AND detail."categoryId" = "Transaction"."categoryId"
      AND detail."subcategoryId" = "Transaction"."subcategoryId"
      AND detail."planningClass" = CASE
        WHEN "Transaction"."type" = 'EXPENSE' THEN 'EXPENSE'
        WHEN "Transaction"."financialKind" = 'CARD_PAYMENT' THEN 'CARD_SETTLEMENT'
        ELSE ''
      END
    LIMIT 1
  ),
  "budgetImpactMinor" = CASE WHEN (
    SELECT detail."id"
    FROM "BudgetDetail" AS detail
    INNER JOIN "BudgetMaster" AS budget ON budget."id" = detail."budgetMasterId"
    WHERE budget."month" = substr("Transaction"."date", 1, 7)
      AND detail."categoryId" = "Transaction"."categoryId"
      AND detail."subcategoryId" = "Transaction"."subcategoryId"
      AND detail."planningClass" = CASE
        WHEN "Transaction"."type" = 'EXPENSE' THEN 'EXPENSE'
        WHEN "Transaction"."financialKind" = 'CARD_PAYMENT' THEN 'CARD_SETTLEMENT'
        ELSE ''
      END
    LIMIT 1
  ) IS NULL THEN 0 ELSE "Transaction"."amountMinor" END;

UPDATE "BudgetDetail"
SET
  "spendMinor" = (
    SELECT COALESCE(SUM(txn."budgetImpactMinor"), 0)
    FROM "Transaction" AS txn
    WHERE txn."budgetDetailId" = "BudgetDetail"."id"
  ),
  "balanceMinor" = "budgetAmountMinor" - (
    SELECT COALESCE(SUM(txn."budgetImpactMinor"), 0)
    FROM "Transaction" AS txn
    WHERE txn."budgetDetailId" = "BudgetDetail"."id"
  );

UPDATE "BudgetMaster"
SET
  "totalProjectedExpenditureMinor" = (
    SELECT COALESCE(SUM(detail."budgetAmountMinor"), 0)
    FROM "BudgetDetail" AS detail
    WHERE detail."budgetMasterId" = "BudgetMaster"."id" AND detail."planningClass" <> 'CARD_SETTLEMENT'
  ),
  "currentSpendingMinor" = (
    SELECT COALESCE(SUM(txn."amountMinor"), 0)
    FROM "Transaction" AS txn
    WHERE substr(txn."date", 1, 7) = "BudgetMaster"."month" AND txn."type" = 'EXPENSE'
  ),
  "balanceProvisioningMinor" = (
    SELECT COALESCE(SUM(detail."budgetAmountMinor" - detail."spendMinor"), 0)
    FROM "BudgetDetail" AS detail
    WHERE detail."budgetMasterId" = "BudgetMaster"."id" AND detail."planningClass" <> 'CARD_SETTLEMENT'
  ),
  "settlementPlannedMinor" = (
    SELECT COALESCE(SUM(detail."budgetAmountMinor"), 0)
    FROM "BudgetDetail" AS detail
    WHERE detail."budgetMasterId" = "BudgetMaster"."id" AND detail."planningClass" = 'CARD_SETTLEMENT'
  ),
  "settlementUsedMinor" = (
    SELECT COALESCE(SUM(detail."spendMinor"), 0)
    FROM "BudgetDetail" AS detail
    WHERE detail."budgetMasterId" = "BudgetMaster"."id" AND detail."planningClass" = 'CARD_SETTLEMENT'
  ),
  "projectionRevision" = "projectionRevision" + 1;

UPDATE "AppSettings" SET "dataRevision" = "dataRevision" + 1 WHERE "id" = 1;