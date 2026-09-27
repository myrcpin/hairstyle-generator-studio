import { admin } from "./db.ts";
import { HttpError } from "./http.ts";
import { sha256Hex } from "./core/tokens.ts";

/** Hashed client IP (salted). Raw IPs are never stored. */
export async function ipHash(req: Request): Promise<string> {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("cf-connecting-ip") || "unknown";
  const salt = Deno.env.get("IP_HASH_SALT") ?? "change-me";
  return (await sha256Hex(`${salt}:${ip}`)).slice(0, 32);
}

export async function deviceHash(req: Request): Promise<string | null> {
  const d = req.headers.get("x-device-id");
  if (!d || !/^[A-Za-z0-9_-]{16,64}$/.test(d)) return null;
  const salt = Deno.env.get("IP_HASH_SALT") ?? "change-me";
  return (await sha256Hex(`${salt}:dev:${d}`)).slice(0, 32);
}

/** Throws 429 when the fixed window is exhausted. Fails open on DB errors (logged). */
export async function rateLimit(key: string, windowSeconds: number, max: number | undefined) {
  if (!max || max <= 0) return;
  const { data, error } = await admin().rpc("consume_rate_limit", { p_key: key, p_window_seconds: windowSeconds, p_max: max });
  if (error) {
    console.error("rate limit error", error.message);
    return;
  }
  if (data === false) throw new HttpError(429, "rate_limited");
}
