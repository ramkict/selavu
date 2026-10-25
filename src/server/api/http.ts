import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { DomainError, conflict } from "../lib/errors";
import { todayIn } from "../lib/calendar";
import { getDb, type Db } from "../db";
import type { Tx } from "../domain/projections";

export const MAX_BODY_BYTES = 64 * 1024;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export function ok(data: unknown, status = 200, extra?: Record<string, unknown>) {
  return NextResponse.json({ data, ...extra }, { status, headers: { "Cache-Control": "no-store" } });
}

export function errorResponse(error: unknown, requestId: string) {
  const headers = { "Cache-Control": "no-store", "X-Request-Id": requestId };
  if (error instanceof DomainError) {
    const body = { error: { code: error.code, message: error.message, fieldErrors: error.fieldErrors, requestId } };
    return NextResponse.json(body, { status: error.status, headers });
  }
  if (isBusyError(error)) {
    return NextResponse.json(
      { error: { code: "TRANSIENT_DB_BUSY", message: "The local database is busy. Please retry.", requestId } },
      { status: 503, headers: { ...headers, "Retry-After": "1" } },
    );
  }
  console.error(JSON.stringify({ level: "error", requestId, message: error instanceof Error ? error.name : "unknown" }));
  return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong.", requestId } }, { status: 500, headers });
}

function isBusyError(error: unknown) {
  const text = error instanceof Error ? `${error.message} ${(error as { code?: string }).code ?? ""}` : "";
  return /SQLITE_BUSY|SQLITE_LOCKED|P2034/.test(text);
}

/** Wraps a Route Handler with request IDs and uniform error mapping. */
export function route<A extends unknown[]>(handler: (req: Request, requestId: string, ...args: A) => Promise<Response>) {
  return async (req: Request, ...args: A): Promise<Response> => {
    const requestId = randomUUID();
    try {
      const response = await handler(req, requestId, ...args);
      response.headers.set("X-Request-Id", requestId);
      return response;
    } catch (error) {
      return errorResponse(error, requestId);
    }
  };
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const length = Number(req.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) throw new DomainError(413, "PAYLOAD_TOO_LARGE", "Request body is too large.");
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) throw new DomainError(413, "PAYLOAD_TOO_LARGE", "Request body is too large.");
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return parsed as Record<string, unknown>;
  } catch {
    throw new DomainError(400, "MALFORMED_INPUT", "Request body must be a JSON object.");
  }
}

/** Version precondition from If-Match (DELETE) or expectedVersion (PATCH body). */
export function ifMatchVersion(req: Request): number {
  const raw = req.headers.get("if-match");
  if (!raw) throw new DomainError(428, "PRECONDITION_REQUIRED", "Send If-Match with the record version you are deleting.");
  const version = Number(raw.replace(/"/g, ""));
  if (!Number.isInteger(version) || version < 1) throw new DomainError(400, "MALFORMED_INPUT", "If-Match must be a version number.");
  return version;
}

export function expectedVersionFrom(body: Record<string, unknown>): number {
  const v = body.expectedVersion;
  if (v === undefined || v === null) throw new DomainError(428, "PRECONDITION_REQUIRED", "expectedVersion is required for updates.");
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) throw new DomainError(400, "MALFORMED_INPUT", "expectedVersion must be a positive integer.");
  return v;
}

export async function clock(tx: Tx | Db) {
  const settings = await tx.appSettings.findUniqueOrThrow({ where: { id: 1 }, select: { timezone: true } });
  return { timeZone: settings.timezone, today: todayIn(settings.timezone) };
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(Object.keys(v).sort().map((k) => [k, (v as Record<string, unknown>)[k]]));
    }
    return v;
  });
}

/**
 * Runs a mutation atomically. With Idempotency-Key, the first committed response is stored in the
 * same transaction; the same key and payload replays it, a different payload conflicts.
 */
export async function runMutation(
  req: Request,
  scope: string,
  payload: unknown,
  run: (tx: Tx, ctx: { requestId: string; today: string }) => Promise<{ status: number; body: unknown }>,
  requestId: string,
): Promise<Response> {
  const db = await getDb();
  const key = req.headers.get("idempotency-key");
  const requestHash = createHash("sha256").update(stableStringify(payload)).digest("hex");

  const result = await db.$transaction(
    async (tx) => {
      if (key) {
        const prior = await tx.idempotencyRecord.findUnique({ where: { routeScope_key: { routeScope: scope, key } } });
        if (prior && prior.expiresAt > new Date()) {
          if (prior.requestHash !== requestHash) {
            throw conflict("This Idempotency-Key was already used with a different request.");
          }
          return { status: prior.status, body: JSON.parse(prior.responseBody) as unknown, replayed: true };
        }
        if (prior) await tx.idempotencyRecord.delete({ where: { id: prior.id } });
      }
      const { today } = await clock(tx);
      const outcome = await run(tx, { requestId, today });
      if (key) {
        await tx.idempotencyRecord.create({
          data: {
            routeScope: scope,
            key,
            requestHash,
            status: outcome.status,
            responseBody: JSON.stringify(outcome.body),
            expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
          },
        });
      }
      return { ...outcome, replayed: false };
    },
    { maxWait: 5000, timeout: 15000 },
  );

  const headers = result.replayed ? { "Idempotent-Replayed": "true" } : undefined;
  if (result.status === 204) return new NextResponse(null, { status: 204, headers });
  return NextResponse.json(result.body, { status: result.status, headers });
}
