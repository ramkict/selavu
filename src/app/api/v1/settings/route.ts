import { getDb } from "@/server/db";
import { ok, route } from "@/server/api/http";
import { getSettings } from "@/server/domain/reference";

export const runtime = "nodejs";

export const GET = route(async () => {
  const db = await getDb();
  return ok(await db.$transaction((tx) => getSettings(tx)));
});
