import { getDb } from "@/server/db";
import { expectedVersionFrom, ok, readJson, route, runMutation } from "@/server/api/http";
import { categoryPatchBody, parseBody } from "@/server/api/schemas";
import { updateCategory } from "@/server/domain/categories";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = route(async (req, requestId, ctx: Ctx) => {
  const { id } = await ctx.params;
  const raw = await readJson(req);
  const expectedVersion = expectedVersionFrom(raw);
  const body = parseBody(categoryPatchBody, raw);
  return runMutation(req, `categories.update:${id}`, body, async (tx, context) => ({
    status: 200,
    body: { data: await updateCategory(tx, id, expectedVersion, body, { requestId: context.requestId }) },
  }), requestId);
});

export const GET = route(async (_req, _requestId, ctx: Ctx) => {
  const { id } = await ctx.params;
  const db = await getDb();
  const category = await db.category.findUnique({ where: { id } });
  if (!category) return ok(null, 404);
  return ok(category);
});