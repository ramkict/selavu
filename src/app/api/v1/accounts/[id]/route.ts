import { z } from "zod";
import { getDb } from "@/server/db";
import { expectedVersionFrom, ifMatchVersion, ok, readJson, route, runMutation } from "@/server/api/http";
import { parseBody, parseQuery, accountPatchBody } from "@/server/api/schemas";
import { deleteAccount, getAccount, updateAccount } from "@/server/domain/accounts";
import { getSettings } from "@/server/domain/reference";
import { currentMonthIn, isValidMonth } from "@/server/lib/calendar";
import { DomainError } from "@/server/lib/errors";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (req, _requestId, ctx: Ctx) => {
  const { id } = await ctx.params;
  const { month } = parseQuery(z.strictObject({ month: z.string().optional() }), new URL(req.url).searchParams);
  if (month !== undefined && !isValidMonth(month)) throw new DomainError(400, "MALFORMED_INPUT", "month must be YYYY-MM.");
  const db = await getDb();
  return ok(
    await db.$transaction(async (tx) => {
      const settings = await getSettings(tx);
      return getAccount(tx, id, month ?? currentMonthIn(settings.timezone));
    }),
  );
});

export const DELETE = route(async (req, requestId, ctx: Ctx) => {
  const { id } = await ctx.params;
  const version = ifMatchVersion(req);
  return runMutation(req, `accounts.delete:${id}`, { id, version }, async (tx, c) => {
    await deleteAccount(tx, id, version, { today: c.today, requestId });
    return { status: 204, body: null };
  }, requestId);
});

export const PATCH = route(async (req, requestId, ctx: Ctx) => {
  const { id } = await ctx.params;
  const raw = await readJson(req);
  const expectedVersion = expectedVersionFrom(raw);
  const body = parseBody(accountPatchBody, raw);
  return runMutation(
    req,
    `accounts.update:${id}`,
    body,
    async (tx, c) => ({
      status: 200,
      body: { data: await updateAccount(tx, id, expectedVersion, body, { today: c.today, requestId }) },
    }),
    requestId,
  );
});
