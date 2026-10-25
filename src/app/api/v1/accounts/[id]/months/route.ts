import { getDb } from "@/server/db";
import { ok, route } from "@/server/api/http";
import { listAccountMonths } from "@/server/domain/accounts";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_req, _requestId, ctx: Ctx) => {
  const { id } = await ctx.params;
  const db = await getDb();
  return ok(await db.$transaction((tx) => listAccountMonths(tx, id)));
});
