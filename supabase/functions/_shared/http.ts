import { type ErrorCode, messageFor } from "./core/errors.ts";

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? Deno.env.get("SITE_URL") ?? "")
  .split(",").map((s) => s.trim()).filter(Boolean);

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  // Exact-origin allowlist (CSRF defence for cookie-less bearer auth is the Authorization header itself,
  // but we still refuse cross-site browser calls from unknown origins).
  const allow = ALLOWED_ORIGINS.length === 0 ? "*" : ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-device-id",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };
}

export class HttpError extends Error {
  constructor(public status: number, public code: ErrorCode, public extra?: Record<string, unknown>) {
    super(code);
  }
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** Wraps a handler: CORS preflight, origin check, error → human message, no stack traces to clients. */
export function serve(handler: (req: Request) => Promise<Response>, opts: { checkOrigin?: boolean } = { checkOrigin: true }) {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
    try {
      if (opts.checkOrigin !== false && ALLOWED_ORIGINS.length) {
        const origin = req.headers.get("origin");
        if (origin && !ALLOWED_ORIGINS.includes(origin)) throw new HttpError(403, "forbidden");
      }
      return await handler(req);
    } catch (e) {
      if (e instanceof HttpError) {
        return json(req, { error: { code: e.code, message: messageFor(e.code), ...e.extra } }, e.status);
      }
      console.error("unhandled", e instanceof Error ? `${e.name}: ${e.message}` : String(e));
      return json(req, { error: { code: "server_error", message: messageFor("server_error") } }, 500);
    }
  });
}

export async function readJson<T = Record<string, unknown>>(req: Request, maxBytes = 32_000): Promise<T> {
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, "invalid_input");
  try {
    const v = JSON.parse(text || "{}");
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
    return v as T;
  } catch {
    throw new HttpError(400, "invalid_input");
  }
}

export function requireEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) {
    console.error(`missing env ${name}`);
    throw new HttpError(503, "service_unavailable");
  }
  return v;
}

export const isUuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
