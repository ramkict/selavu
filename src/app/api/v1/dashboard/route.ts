import { getDb } from "@/server/db";
import { ok, route } from "@/server/api/http";
import { parseQuery } from "@/server/api/schemas";
import { getDashboard } from "@/server/domain/dashboard";
import { getSettings } from "@/server/domain/reference";
import { currentMonthIn } from "@/server/lib/calendar";
import { z } from "zod";

export const runtime = "nodejs";

export const GET = route(async (req) => {
  const { month } = parseQuery(z.strictObject({ month: z.string().optional() }), new URL(req.url).searchParams);
  const db = await getDb();
  return ok(
    await db.$transaction(async (tx) => {
      const settings = await getSettings(tx);
      return getDashboard(tx, month ?? currentMonthIn(settings.timezone));
    }),
  );
});
