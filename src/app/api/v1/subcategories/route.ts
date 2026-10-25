import { readJson, route, runMutation } from "@/server/api/http";
import { parseBody, subcategoryCreateBody } from "@/server/api/schemas";
import { createSubcategory } from "@/server/domain/categories";

export const runtime = "nodejs";

export const POST = route(async (req, requestId) => {
  const body = parseBody(subcategoryCreateBody, await readJson(req));
  return runMutation(req, "subcategories.create", body, async (tx, ctx) => ({
    status: 201,
    body: { data: await createSubcategory(tx, body, { requestId: ctx.requestId }) },
  }), requestId);
});