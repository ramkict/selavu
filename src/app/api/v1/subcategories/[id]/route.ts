import { expectedVersionFrom, readJson, route, runMutation } from "@/server/api/http";
import { parseBody, subcategoryPatchBody } from "@/server/api/schemas";
import { updateSubcategory } from "@/server/domain/categories";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = route(async (req, requestId, ctx: Ctx) => {
  const { id } = await ctx.params;
  const raw = await readJson(req);
  const expectedVersion = expectedVersionFrom(raw);
  const body = parseBody(subcategoryPatchBody, raw);
  return runMutation(req, `subcategories.update:${id}`, body, async (tx, context) => ({
    status: 200,
    body: { data: await updateSubcategory(tx, id, expectedVersion, body, { requestId: context.requestId }) },
  }), requestId);
});