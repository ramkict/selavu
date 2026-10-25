import { getDb } from "@/server/db";
import { ok, readJson, route, runMutation } from "@/server/api/http";
import { configuredMonthCreateBody, parseBody } from "@/server/api/schemas";
import { addConfiguredMonth, listConfiguredMonths } from "@/server/domain/months";

export const runtime = "nodejs";

export const GET = route(async () => {
  const db = await getDb();
  return ok(await db.$transaction(listConfiguredMonths));
});

export const POST = route(async (req, requestId) => {
  const body = parseBody(configuredMonthCreateBody, await readJson(req));
  return runMutation(req, "months.create", body, async (tx, ctx) => ({
    status: 201,
    body: { data: await addConfiguredMonth(tx, body.month, { today: ctx.today, requestId: ctx.requestId }) },
  }), requestId);
});