import { getDb } from "@/server/db";
import { expectedVersionFrom, ifMatchVersion, ok, readJson, route, runMutation } from "@/server/api/http";
import { parseBody, budgetPatchBody } from "@/server/api/schemas";
import { toBudgetLines } from "@/server/api/inputs";
import { deleteBudget, getBudgetById, updateBudget } from "@/server/domain/budgets";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_req, _requestId, ctx: Ctx) => {
  const { id } = await ctx.params;
  const db = await getDb();
  return ok(await db.$transaction((tx) => getBudgetById(tx, id)));
});

export const PATCH = route(async (req, requestId, ctx: Ctx) => {
  const { id } = await ctx.params;
  const raw = await readJson(req);
  const expectedVersion = expectedVersionFrom(raw);
  const body = parseBody(budgetPatchBody, raw);
  return runMutation(
    req,
    `budgets.update:${id}`,
    body,
    async (tx, c) => ({
      status: 200,
      body: { data: await updateBudget(tx, id, expectedVersion, { lines: toBudgetLines(body.lines) }, { today: c.today, requestId }) },
    }),
    requestId,
  );
});

export const DELETE = route(async (req, requestId, ctx: Ctx) => {
  const { id } = await ctx.params;
  const version = ifMatchVersion(req);
  return runMutation(
    req,
    `budgets.delete:${id}`,
    { id, version },
    async (tx, c) => {
      await deleteBudget(tx, id, version, { today: c.today, requestId });
      return { status: 204, body: null };
    },
    requestId,
  );
});
