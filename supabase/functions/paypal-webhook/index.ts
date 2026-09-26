// PayPal webhook receiver: signature-verified, idempotent, re-fetches authoritative state.
import { serve } from "../_shared/http.ts";
import { admin } from "../_shared/db.ts";
import { verifyWebhook } from "../_shared/paypal.ts";
import { syncSubscription } from "../_shared/subscriptions.ts";
import { track } from "../_shared/analytics.ts";
import { HANDLED_WEBHOOK_EVENTS, subscriptionIdFromEvent } from "../_shared/core/paypal.ts";
import { isUuid } from "../_shared/http.ts";

const plain = (status: number, text = "") => new Response(text, { status });

serve(async (req) => {
  if (req.method !== "POST") return plain(405);
  const raw = await req.text();
  if (raw.length > 200_000) return plain(413);
  if (!(await verifyWebhook(req, raw))) return plain(401, "invalid signature");

  const event = JSON.parse(raw) as { id: string; event_type: string; resource: Record<string, unknown> };
  const db = admin();

  // Idempotency: record the event id first; skip if already processed.
  const { data: existing } = await db.from("paypal_events").select("processed_at,attempts").eq("event_id", event.id).maybeSingle();
  if (existing?.processed_at) return plain(200, "duplicate");
  if (!existing) {
    const { error } = await db.from("paypal_events").insert({ event_id: event.id, event_type: event.event_type, resource_id: String(event.resource?.id ?? "") });
    if (error && !error.message.includes("duplicate")) return plain(500);
  }
  await db.from("paypal_events").update({ attempts: (existing?.attempts ?? 0) + 1 }).eq("event_id", event.id);

  try {
    if ((HANDLED_WEBHOOK_EVENTS as readonly string[]).includes(event.event_type)) await handle(event);
    await db.from("paypal_events").update({ processed_at: new Date().toISOString(), last_error: null }).eq("event_id", event.id);
    return plain(200, "ok");
  } catch (e) {
    await db.from("paypal_events").update({ last_error: String((e as Error).message).slice(0, 300) }).eq("event_id", event.id);
    return plain(500, "retry"); // PayPal retries; our idempotency makes that safe
  }
}, { checkOrigin: false });

async function handle(event: { id: string; event_type: string; resource: Record<string, unknown> }) {
  const db = admin();
  const r = event.resource;
  const subId = subscriptionIdFromEvent(event.event_type, r);

  if (event.event_type.startsWith("PAYMENT.SALE.") && subId) {
    const { data: user } = await db.from("users").select("id").eq("paypal_subscription_id", subId).maybeSingle();
    const amount = (r.amount ?? {}) as { total?: string; currency?: string };
    const status = event.event_type === "PAYMENT.SALE.COMPLETED" ? "completed" : event.event_type === "PAYMENT.SALE.REFUNDED" ? "refunded" : "reversed";
    const txId = event.event_type === "PAYMENT.SALE.COMPLETED" ? String(r.id) : `${r.id}:${status}`;
    await db.from("payments").upsert({
      user_id: user?.id ?? (isUuid(r.custom) ? r.custom : null), paypal_event_id: event.id, transaction_id: txId,
      subscription_id: subId, plan_code: "plus_monthly", kind: "subscription",
      amount: amount.total ? Number(amount.total) * (status === "completed" ? 1 : -1) : null, currency: amount.currency ?? null, status,
    }, { onConflict: "transaction_id", ignoreDuplicates: true });
  }

  if (event.event_type === "BILLING.SUBSCRIPTION.PAYMENT.FAILED" && subId) {
    const { data: user } = await db.from("users").select("id").eq("paypal_subscription_id", subId).maybeSingle();
    await db.from("payments").upsert({
      user_id: user?.id ?? null, paypal_event_id: event.id, transaction_id: `failed:${event.id}`, subscription_id: subId, status: "failed",
    }, { onConflict: "transaction_id", ignoreDuplicates: true });
  }

  if (subId) {
    const result = await syncSubscription(subId);
    if (result) await db.from("payments").update({ user_id: result.userId }).eq("subscription_id", subId).is("user_id", null);
    if (result && event.event_type === "PAYMENT.SALE.COMPLETED" && result.status === "active") {
      const { count } = await db.from("payments").select("id", { count: "exact", head: true }).eq("subscription_id", subId).eq("status", "completed");
      if (count === 1) await track("subscription_completed", result.userId, null, { via: "webhook" });
    }
    return;
  }

  // Future one-time Style Pack (PayPal Orders): custom_id = "<user_uuid>:<plan_code>".
  if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") {
    const [userId, planCode] = String(r.custom_id ?? "").split(":");
    if (!isUuid(userId) || !planCode) return;
    const { data: plan } = await db.from("plans").select("*").eq("code", planCode).eq("kind", "one_time").maybeSingle();
    if (!plan) return;
    const amount = (r.amount ?? {}) as { value?: string; currency_code?: string };
    const { data: payment, error } = await db.from("payments").insert({
      user_id: userId, paypal_event_id: event.id, transaction_id: String(r.id), plan_code: planCode, kind: "one_time",
      amount: amount.value ? Number(amount.value) : null, currency: amount.currency_code ?? null, status: "completed",
    }).select("id").single();
    if (error) return; // duplicate capture
    await db.from("credit_grants").insert({
      user_id: userId, plan_code: planCode, payment_id: payment.id, generations: plan.generations, alterations: plan.alterations,
      card_builds: plan.card_builds, expires_at: plan.grant_days ? new Date(Date.now() + plan.grant_days * 86_400_000).toISOString() : null,
    });
  }
}
