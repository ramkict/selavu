import { NextResponse, type NextRequest } from "next/server";

/**
 * Local-service safeguards only (no identity features): accept only loopback Host headers
 * (defends against DNS rebinding) and reject cross-origin browser mutations to the API.
 */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function hostnameOf(value: string): string | null {
  try {
    return new URL(value.includes("://") ? value : `http://${value}`).hostname;
  } catch {
    return null;
  }
}

export function proxy(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  if (!LOOPBACK_HOSTS.has(hostnameOf(host) ?? "")) {
    return NextResponse.json({ error: { code: "FORBIDDEN_HOST", message: "Requests must target the local loopback address." } }, { status: 403 });
  }

  if (request.nextUrl.pathname.startsWith("/api/") && !SAFE_METHODS.has(request.method)) {
    const origin = request.headers.get("origin");
    const fetchSite = request.headers.get("sec-fetch-site");
    const originHost = origin ? hostnameOf(origin) : null;
    if ((origin && (originHost !== hostnameOf(host) || !LOOPBACK_HOSTS.has(originHost ?? ""))) || fetchSite === "cross-site") {
      return NextResponse.json({ error: { code: "FORBIDDEN_ORIGIN", message: "Cross-origin changes are not allowed." } }, { status: 403 });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
