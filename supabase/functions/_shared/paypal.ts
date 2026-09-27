// PayPal REST client (server-side only). Credentials never leave the edge function.
import { requireEnv } from "./http.ts";
import type { PaypalSubscription } from "./core/paypal.ts";

function base(): string {
  const override = Deno.env.get("PAYPAL_API_BASE"); // e.g. a local mock in integration tests
  if (override) return override;
  return (Deno.env.get("PAYPAL_ENV") ?? "sandbox") === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

let tokenCache: { token: string; exp: number } | null = null;

async function accessToken(): Promise<string> {
  if (tokenCache && tokenCache.exp > Date.now() + 60_000) return tokenCache.token;
  const id = requireEnv("PAYPAL_CLIENT_ID");
  const secret = requireEnv("PAYPAL_CLIENT_SECRET");
  const res = await fetch(`${base()}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${btoa(`${id}:${secret}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`paypal auth ${res.status}`);
  const body = await res.json();
  tokenCache = { token: body.access_token, exp: Date.now() + body.expires_in * 1000 };
  return tokenCache.token;
}

export async function paypal<T = Record<string, unknown>>(path: string, init: RequestInit & { idempotencyKey?: string } = {}): Promise<{ status: number; body: T }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await accessToken()}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (init.idempotencyKey) headers["PayPal-Request-Id"] = init.idempotencyKey;
  const res = await fetch(`${base()}${path}`, { ...init, headers });
  const text = await res.text();
  const body = (text ? JSON.parse(text) : {}) as T;
  if (!res.ok) console.error(`paypal ${path} ${res.status} ${(body as Record<string, unknown>)?.name ?? ""}`);
  return { status: res.status, body };
}

export async function getSubscription(id: string): Promise<PaypalSubscription | null> {
  const { status, body } = await paypal<PaypalSubscription>(`/v1/billing/subscriptions/${encodeURIComponent(id)}`);
  return status === 200 ? body : null;
}

/** Verifies a webhook with PayPal's verify-webhook-signature API. */
export async function verifyWebhook(req: Request, rawBody: string): Promise<boolean> {
  const webhookId = requireEnv("PAYPAL_WEBHOOK_ID");
  const h = (n: string) => req.headers.get(n) ?? "";
  if (!h("paypal-transmission-id") || !h("paypal-transmission-sig")) return false;
  let event: unknown;
  try { event = JSON.parse(rawBody); } catch { return false; }
  const { status, body } = await paypal<{ verification_status?: string }>("/v1/notifications/verify-webhook-signature", {
    method: "POST",
    body: JSON.stringify({
      auth_algo: h("paypal-auth-algo"),
      cert_url: h("paypal-cert-url"),
      transmission_id: h("paypal-transmission-id"),
      transmission_sig: h("paypal-transmission-sig"),
      transmission_time: h("paypal-transmission-time"),
      webhook_id: webhookId,
      webhook_event: event,
    }),
  });
  return status === 200 && body.verification_status === "SUCCESS";
}
