import { getDb } from "@/server/db";
import { route, ok } from "@/server/api/http";

export const runtime = "nodejs";

/** Non-sensitive liveness and database reachability check. */
export const GET = route(async () => {
  const db = await getDb();
  await db.$queryRaw`SELECT 1`;
  return ok({ status: "ok" });
});
