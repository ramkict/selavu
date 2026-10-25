import { getDb } from "@/server/db";
import { expectedVersionFrom, ifMatchVersion, ok, readJson, route, runMutation } from "@/server/api/http";
import { parseBody, transactionPatchBody } from "@/server/api/schemas";
import { toTransactionInput } from "@/server/api/inputs";
import { deleteTransaction, getTransaction, updateTransaction } from "@/server/domain/transactions";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_req, _requestId, ctx: Ctx) => {
  const { id } = await ctx.params;
  const db = await getDb();
  return ok(await db.$transaction((tx) => getTransaction(tx, id)));
});

export const PATCH = route(async (req, requestId, ctx: Ctx) => {
  const { id } = await ctx.params;
  const raw = await readJson(req);
  const expectedVersion = expectedVersionFrom(raw);
  const body = parseBody(transactionPatchBody, raw);
  return runMutation(
    req,
    `transactions.update:${id}`,
    body,
    async (tx, c) => ({
      status: 200,
      body: { data: await updateTransaction(tx, id, expectedVersion, toTransactionInput(body), { today: c.today, requestId }) },
    }),
    requestId,
  );
});

export const DELETE = route(async (req, requestId, ctx: Ctx) => {
  const { id } = await ctx.params;
  const version = ifMatchVersion(req);
  return runMutation(
    req,
    `transactions.delete:${id}`,
    { id, version },
    async (tx, c) => {
      await deleteTransaction(tx, id, version, { today: c.today, requestId });
      return { status: 204, body: null };
    },
    requestId,
  );
});
