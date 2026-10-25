export type FieldErrors = Record<string, string[]>;

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly fieldErrors: FieldErrors,
  ) {
    super(message);
  }
}

/** Calls /api/v1 and unwraps `data`; errors carry server field errors for inline display. */
export async function apiRequest<T>(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(json.error?.message ?? "The request failed.", res.status, json.error?.code ?? "ERROR", json.error?.fieldErrors ?? {});
  }
  return json.data as T;
}

export const newIdempotencyKey = () => crypto.randomUUID();
