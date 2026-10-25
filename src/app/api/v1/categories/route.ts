import { getDb } from "@/server/db";
import { ok, readJson, route, runMutation } from "@/server/api/http";
import { parseBody, categoryCreateBody } from "@/server/api/schemas";
import { listCategories } from "@/server/domain/reference";
import { createCategory } from "@/server/domain/categories";

export const runtime = "nodejs";

export const GET = route(async () => {
  const db = await getDb();
  return ok(await db.$transaction((tx) => listCategories(tx)));
});

export const POST = route(async (req, requestId) => {
  const body = parseBody(categoryCreateBody, await readJson(req));
  return runMutation(req, "categories.create", body, async (tx, ctx) => ({
    status: 201,
    body: { data: await createCategory(tx, body, { requestId: ctx.requestId }) },
  }), requestId);
});
