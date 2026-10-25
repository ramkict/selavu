import { randomUUID } from "node:crypto";
import { conflict, notFound, semantic, staleVersion } from "../lib/errors";
import { assertDate, monthOf } from "../lib/calendar";
import { formatMinor, parseSignedMinorString } from "../lib/money";
import { cleanName, normalizeName } from "../lib/text";
import { audit, bumpDataRevision, refreshAccounts, type Tx } from "./projections";
import { ACCOUNT_TYPE_LABELS, USER_ACCOUNT_TYPES, isExternal, isLiability, signClass, type AccountType } from "./rules";

export type CommandContext = { today: string; requestId?: string };

type AccountRow = {
  id: string;
  name: string;
  accountType: string;
  isSystem: boolean;
  openingBalanceMinor: bigint;
  openingDate: string;
  currentBalanceMinor: bigint;
  balanceAsOf: string | null;
  archivedAt: Date | null;
  version: number;
};

type MonthSnapshot = { openingBalanceMinor: bigint | null; closingBalanceMinor: bigint | null; asOfDate: string | null };

/**
 * Serializes an account with its persisted figures:
 *   startingBalance  = AccountMaster.openingBalanceMinor (opening date)
 *   monthOpening     = RunningAccount.openingBalanceMinor for the selected month
 *   monthClosing     = RunningAccount.closingBalanceMinor for the selected month
 *   currentBalance   = AccountMaster.currentBalanceMinor
 * Money is always returned as integer paise plus a ₹ string with two decimals.
 */
export function serializeAccount(a: AccountRow, month?: string, snapshot?: MonthSnapshot | null) {
  const liability = isLiability(a.accountType);
  const external = isExternal(a.accountType);
  const monthStatus = !month
    ? null
    : snapshot
      ? "OPEN"
      : monthOf(a.openingDate) > month
        ? "NOT_OPENED"
        : "UNKNOWN";
  return {
    id: a.id,
    name: a.name,
    accountType: a.accountType,
    accountTypeLabel: a.isSystem ? "Generic account" : ACCOUNT_TYPE_LABELS[a.accountType as AccountType] ?? a.accountType,
    kind: external ? "EXTERNAL" : liability ? "LIABILITY" : "ASSET",
    isProtected: a.isSystem,
    openingDate: a.openingDate,
    startingBalanceMinor: a.openingBalanceMinor.toString(),
    startingBalanceFormatted: formatMinor(a.openingBalanceMinor),
    month: month ?? null,
    monthStatus,
    monthOpeningMinor: snapshot?.openingBalanceMinor?.toString() ?? null,
    monthOpeningFormatted: snapshot?.openingBalanceMinor == null ? null : formatMinor(snapshot.openingBalanceMinor),
    monthClosingMinor: snapshot?.closingBalanceMinor?.toString() ?? null,
    monthClosingFormatted: snapshot?.closingBalanceMinor == null ? null : formatMinor(snapshot.closingBalanceMinor),
    currentBalanceMinor: a.currentBalanceMinor.toString(),
    currentBalanceFormatted: formatMinor(a.currentBalanceMinor),
    balanceAsOf: a.balanceAsOf,
    balanceNote: liability ? (a.currentBalanceMinor < 0n ? "Credit available" : "Debt outstanding") : null,
    archivedAt: a.archivedAt?.toISOString() ?? null,
    version: a.version,
  };
}

/** Lists accounts with the selected month's persisted snapshot (Overview header month). */
export async function listAccounts(tx: Tx, month: string) {
  const [rows, snapshots] = await Promise.all([
    tx.accountMaster.findMany({ orderBy: [{ isSystem: "desc" }, { name: "asc" }] }),
    tx.runningAccount.findMany({ where: { month } }),
  ]);
  const byAccount = new Map(snapshots.map((s) => [s.accountId, s]));
  return rows.map((a) => {
    const s = byAccount.get(a.id);
    return serializeAccount(a, month, s ? { openingBalanceMinor: s.openingBalanceMinor, closingBalanceMinor: s.closingBalanceMinor, asOfDate: s.asOfDate } : null);
  });
}

export async function getAccount(tx: Tx, id: string, month?: string) {
  const row = await tx.accountMaster.findUnique({ where: { id } });
  if (!row) throw notFound("Account");
  const s = month ? await tx.runningAccount.findUnique({ where: { accountId_month: { accountId: id, month } } }) : null;
  return serializeAccount(row, month, s ? { openingBalanceMinor: s.openingBalanceMinor, closingBalanceMinor: s.closingBalanceMinor, asOfDate: s.asOfDate } : null);
}

export async function listAccountMonths(tx: Tx, id: string) {
  const row = await tx.accountMaster.findUnique({ where: { id }, select: { id: true } });
  if (!row) throw notFound("Account");
  const months = await tx.runningAccount.findMany({ where: { accountId: id }, orderBy: { month: "desc" } });
  return months.map((m) => ({
    month: m.month,
    openingBalanceMinor: m.openingBalanceMinor?.toString() ?? null,
    openingFormatted: m.openingBalanceMinor == null ? null : formatMinor(m.openingBalanceMinor),
    movementMinor: m.movementMinor.toString(),
    closingBalanceMinor: m.closingBalanceMinor?.toString() ?? null,
    closingFormatted: m.closingBalanceMinor == null ? null : formatMinor(m.closingBalanceMinor),
    asOfDate: m.asOfDate,
  }));
}

export async function createAccount(
  tx: Tx,
  input: { name: string; accountType: string; openingBalanceMinor: string; openingDate: string },
  ctx: CommandContext,
) {
  const name = cleanName(input.name);
  const fieldErrors: Record<string, string[]> = {};
  if (!name || name.length > 80) fieldErrors.name = ["Enter a name up to 80 characters."];
  if (!(USER_ACCOUNT_TYPES as readonly string[]).includes(input.accountType)) {
    fieldErrors.accountType = ["Choose Savings, Deposits (FD), Mutual Fund, Credit Card, or Loan."];
  }
  if (Object.keys(fieldErrors).length) throw semantic("Please correct the highlighted fields.", fieldErrors);

  const openingDate = assertDate(input.openingDate, "openingDate");
  if (openingDate > ctx.today) throw semantic("Opening date cannot be in the future.", { openingDate: ["Use today or an earlier date."] });
  const opening = parseSignedMinorString(input.openingBalanceMinor, "openingBalance");

  const normalizedName = normalizeName(name);
  const duplicate = await tx.accountMaster.findUnique({ where: { normalizedName }, select: { id: true } });
  if (duplicate) throw conflict("An account with this name already exists.", { name: ["Name is already in use."] });

  const created = await tx.accountMaster.create({
    data: {
      id: randomUUID(),
      name,
      normalizedName,
      accountType: input.accountType,
      openingBalanceMinor: opening,
      openingDate,
      currentBalanceMinor: opening,
      balanceAsOf: ctx.today,
    },
  });
  await refreshAccounts(tx, [created.id], ctx.today);
  await bumpDataRevision(tx);
  const after = await tx.accountMaster.findUniqueOrThrow({ where: { id: created.id } });
  await audit(tx, { action: "CREATE", entityType: "AccountMaster", entityId: created.id, after: serializeAccount(after), requestId: ctx.requestId });
  return serializeAccount(after);
}

/**
 * Renames or changes the type of an account. Protected accounts (Cash In Hand, Income, Expense)
 * cannot be edited. Once an account has postings, a change across asset/liability sign class is rejected.
 */
export async function updateAccount(
  tx: Tx,
  id: string,
  expectedVersion: number,
  input: { name?: string; accountType?: string; openingBalanceMinor?: string; openingDate?: string; archived?: boolean },
  ctx: CommandContext,
) {
  const before = await tx.accountMaster.findUnique({ where: { id } });
  if (!before) throw notFound("Account");
  if (before.isSystem) throw semantic("Protected accounts cannot be edited.");
  if (before.version !== expectedVersion) throw staleVersion();

  const data: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const name = cleanName(input.name);
    if (!name || name.length > 80) throw semantic("Please correct the highlighted fields.", { name: ["Enter a name up to 80 characters."] });
    const normalizedName = normalizeName(name);
    const dup = await tx.accountMaster.findUnique({ where: { normalizedName }, select: { id: true } });
    if (dup && dup.id !== id) throw conflict("An account with this name already exists.", { name: ["Name is already in use."] });
    Object.assign(data, { name, normalizedName });
  }
  if (input.accountType !== undefined && input.accountType !== before.accountType) {
    if (!(USER_ACCOUNT_TYPES as readonly string[]).includes(input.accountType)) {
      throw semantic("Please correct the highlighted fields.", { accountType: ["Choose a valid account type."] });
    }
    const hasActivity = (await tx.transactionPosting.count({ where: { accountId: id } })) > 0;
    if (hasActivity && signClass(input.accountType) !== signClass(before.accountType)) {
      throw semantic(
        "This account has transactions, so it cannot change between asset and liability. Create a new account or reverse the history first.",
        { accountType: ["Incompatible with existing transactions."] },
      );
    }
    data.accountType = input.accountType;
  }
  if (input.archived !== undefined && input.archived !== !!before.archivedAt) {
    data.archivedAt = input.archived ? new Date() : null;
  }
  const openingChanged = (input.openingBalanceMinor !== undefined && parseSignedMinorString(input.openingBalanceMinor, "openingBalance") !== before.openingBalanceMinor)
    || (input.openingDate !== undefined && input.openingDate !== before.openingDate);
  if (openingChanged) {
    const activity = await tx.transaction.count({ where: { OR: [{ sourceAccountId: id }, { destinationAccountId: id }] } });
    if (activity) throw semantic("Starting balance and opening date cannot be changed after transactions have been recorded.");
    const openingDate = assertDate(input.openingDate ?? before.openingDate, "openingDate");
    if (openingDate > ctx.today) throw semantic("Opening date cannot be in the future.", { openingDate: ["Use today or an earlier date."] });
    Object.assign(data, { openingDate, openingBalanceMinor: input.openingBalanceMinor === undefined ? before.openingBalanceMinor : parseSignedMinorString(input.openingBalanceMinor, "openingBalance") });
  }
  if (Object.keys(data).length === 0) return serializeAccount(before);

  const updated = await tx.accountMaster.updateMany({ where: { id, version: expectedVersion }, data: { ...data, version: { increment: 1 } } });
  if (updated.count !== 1) throw staleVersion();
  if (openingChanged) await refreshAccounts(tx, [id], ctx.today);
  await bumpDataRevision(tx);
  const after = await tx.accountMaster.findUniqueOrThrow({ where: { id } });
  await audit(tx, { action: "UPDATE", entityType: "AccountMaster", entityId: id, before: serializeAccount(before), after: serializeAccount(after), requestId: ctx.requestId });
  return serializeAccount(after);
}

export async function deleteAccount(tx: Tx, id: string, expectedVersion: number, ctx: CommandContext) {
  const before = await tx.accountMaster.findUnique({ where: { id } });
  if (!before) throw notFound("Account");
  if (before.isSystem) throw semantic("Always-present accounts cannot be deleted.");
  if (before.version !== expectedVersion) throw staleVersion();
  const activity = await tx.transaction.count({ where: { OR: [{ sourceAccountId: id }, { destinationAccountId: id }] } });
  if (activity || await tx.transactionPosting.count({ where: { accountId: id } })) {
    throw conflict("This account has transaction history and cannot be deleted.");
  }
  await tx.runningAccount.deleteMany({ where: { accountId: id } });
  const deleted = await tx.accountMaster.deleteMany({ where: { id, version: expectedVersion } });
  if (deleted.count !== 1) throw staleVersion();
  await bumpDataRevision(tx);
  await audit(tx, { action: "DELETE", entityType: "AccountMaster", entityId: id, before: serializeAccount(before), requestId: ctx.requestId });
}
