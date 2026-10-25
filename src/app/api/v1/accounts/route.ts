import { z } from "zod";
import { getDb } from "@/server/db";
import { ok, readJson, route, runMutation } from "@/server/api/http";
import { parseBody, parseQuery, accountCreateBody } from "@/server/api/schemas";
import { createAccount, listAccounts } from "@/server/domain/accounts";
import { getSettings } from "@/server/domain/reference";
import { currentMonthIn, isValidMonth } from "@/server/lib/calendar";
import { DomainError } from "@/server/lib/errors";

export const runtime = "nodejs";

export const GET = route(async (req) => {
  const { month } = parseQuery(z.strictObject({ month: z.string().optional() }), new URL(req.url).searchParams);
  if (month !== undefined && !isValidMonth(month)) throw new DomainError(400, "MALFORMED_INPUT", "month must be YYYY-MM.");
  const db = await getDb();
  return ok(
    await db.$transaction(async (tx) => {
      const settings = await getSettings(tx);
      return listAccounts(tx, month ?? currentMonthIn(settings.timezone));
    }),
  );
});

export const POST = route(async (req, requestId) => {
  const body = parseBody(accountCreateBody, await readJson(req));
  return runMutation(
    req,
    "accounts.create",
    body,
    async (tx, ctx) => ({
      status: 201,
      body: { data: await createAccount(tx, body, { today: ctx.today, requestId }) },
    }),
    requestId,
  );
});
