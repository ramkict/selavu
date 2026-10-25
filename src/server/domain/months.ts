import { conflict, semantic } from "../lib/errors";
import { assertMonth, monthOf } from "../lib/calendar";
import { audit, bumpDataRevision, type Tx } from "./projections";

type Context = { today: string; requestId?: string };

export async function listConfiguredMonths(tx: Tx) {
  const rows = await tx.configuredMonth.findMany({ orderBy: { month: "asc" }, select: { month: true } });
  return rows.map((row) => row.month);
}

export async function addConfiguredMonth(tx: Tx, value: string, ctx: Context) {
  const month = assertMonth(value);
  if (month <= monthOf(ctx.today)) throw semantic("Only future months can be added.", { month: ["Choose a month after the current month."] });
  if (await tx.configuredMonth.findUnique({ where: { month } })) throw conflict(`${month} is already configured.`);
  const created = await tx.configuredMonth.create({ data: { month } });
  await bumpDataRevision(tx);
  await audit(tx, { action: "CREATE", entityType: "ConfiguredMonth", entityId: month, after: created, requestId: ctx.requestId });
  return created.month;
}