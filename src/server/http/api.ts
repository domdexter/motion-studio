import { NextResponse, type NextRequest } from "next/server";
import type { ZodType } from "zod";
import { AppError, toErrorBody } from "../errors";

/**
 * Route handler wrapper for the local API.
 *  - Rejects requests whose Host is not loopback (DNS-rebinding protection).
 *  - Rejects cross-origin state-changing requests (a random website cannot drive the studio).
 *  - Converts thrown AppErrors into { error: { code, message, hint, action } } responses.
 */

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function hostnameOf(hostHeader: string): string {
  const h = hostHeader.trim().toLowerCase();
  if (h.startsWith("[")) return h.slice(0, h.indexOf("]") + 1);
  return h.replace(/:\d+$/, "");
}

export function assertLocalRequest(req: Request): void {
  const host = req.headers.get("host");
  if (!host || !LOOPBACK_HOSTS.has(hostnameOf(host))) {
    throw new AppError("FORBIDDEN", "Motion Studio only accepts requests addressed to localhost.");
  }
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;
  const origin = req.headers.get("origin");
  if (origin && origin !== "null") {
    let ok = false;
    try {
      ok = LOOPBACK_HOSTS.has(new URL(origin).hostname.toLowerCase());
    } catch {
      ok = false;
    }
    if (!ok) throw new AppError("FORBIDDEN", "Cross-origin requests are not allowed.");
  }
  const site = req.headers.get("sec-fetch-site");
  if (site === "cross-site") throw new AppError("FORBIDDEN", "Cross-site requests are not allowed.");
}

export function errorResponse(err: unknown): NextResponse {
  const { status, body } = toErrorBody(err);
  if (status >= 500) console.error("[api]", err);
  return NextResponse.json({ error: body }, { status });
}

type RouteContext<P> = { params: Promise<P> };

export function api<P extends Record<string, string | string[]> = Record<string, string>>(
  handler: (req: NextRequest, params: P) => Promise<unknown>,
) {
  return async (req: NextRequest, context: RouteContext<P>): Promise<Response> => {
    try {
      assertLocalRequest(req);
      const params = context?.params ? await context.params : ({} as P);
      const result = await handler(req, params);
      if (result instanceof Response) return result;
      return NextResponse.json(result === undefined ? { ok: true } : result);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export async function readJson<T>(req: Request, schema: ZodType<T>): Promise<T> {
  const type = req.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) {
    throw new AppError("BAD_REQUEST", "Expected a JSON request body (Content-Type: application/json).");
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new AppError("BAD_REQUEST", "Request body is not valid JSON.");
  }
  return parseWith(schema, body);
}

export function parseWith<T>(schema: ZodType<T>, value: unknown, message = "Invalid request."): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new AppError("VALIDATION", message, {
      details: parsed.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })),
    });
  }
  return parsed.data;
}

export function searchParams(req: NextRequest): URLSearchParams {
  return req.nextUrl.searchParams;
}
