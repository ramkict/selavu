import { getDb } from "@/server/db";
import { ok, readJson, route, runMutation } from "@/server/api/http";
import { parseBody, parseQuery, transactionBody, transactionListQuery } from "@/server/api/schemas";
import { toTransactionInput } from "@/server/api/inputs";
import { createTransaction, listTransactions } from "@/server/domain/transactions";

export const runtime = "nodejs";

export const GET = route(async (req) => {
  const query = parseQuery(transactionListQuery, new URL(req.url).searchParams);
  const db = await getDb();
  const result = await db.$transaction((tx) => listTransactions(tx, query));
  return ok(result);
});

export const POST = route(async (req, requestId) => {
  const body = parseBody(transactionBody, await readJson(req));
  return runMutation(
    req,
    "transactions.create",
    body,
    async (tx, ctx) => ({
      status: 201,
      body: { data: await createTransaction(tx, toTransactionInput(body), { today: ctx.today, requestId }) },
    }),
    requestId,
  );
});
