import { getDb } from "@/server/db";
import { ok, readJson, route, runMutation } from "@/server/api/http";
import { parseBody, parseQuery, budgetCreateBody } from "@/server/api/schemas";
import { toBudgetLines } from "@/server/api/inputs";
import { getBudgetByMonth, createBudget } from "@/server/domain/budgets";
import { currentMonthIn } from "@/server/lib/calendar";
import { z } from "zod";
import { getSettings } from "@/server/domain/reference";

export const runtime = "nodejs";

export const GET = route(async (req) => {
  const { month } = parseQuery(z.strictObject({ month: z.string().optional() }), new URL(req.url).searchParams);
  const db = await getDb();
  return ok(
    await db.$transaction(async (tx) => {
      const settings = await getSettings(tx);
      return getBudgetByMonth(tx, month ?? currentMonthIn(settings.timezone));
    }),
  );
});

export const POST = route(async (req, requestId) => {
  const body = parseBody(budgetCreateBody, await readJson(req));
  return runMutation(
    req,
    "budgets.create",
    body,
    async (tx, c) => ({
      status: 201,
      body: { data: await createBudget(tx, { month: body.month, lines: toBudgetLines(body.lines) }, { today: c.today, requestId }) },
    }),
    requestId,
  );
});
