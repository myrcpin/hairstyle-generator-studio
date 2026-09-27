import { admin } from "./db.ts";
import { getSubscription } from "./paypal.ts";
import { mapSubscription, parseSubscriptionOwner } from "./core/paypal.ts";
import { isUuid } from "./http.ts";

export type SubscriptionOwner = { kind: "user" | "org"; id: string };

/**
 * Pulls the authoritative subscription from PayPal and mirrors it onto the user or salon.
 * Never trusts client-supplied status.
 */
export async function syncSubscription(subscriptionId: string): Promise<{ owner: SubscriptionOwner; userId: string | null; status: string } | null> {
  const db = admin();
  const sub = await getSubscription(subscriptionId);
  if (!sub) throw new Error("paypal_fetch_failed");

  let owner: SubscriptionOwner | null = null;
  const { data: byUser } = await db.from("users").select("id").eq("paypal_subscription_id", subscriptionId).maybeSingle();
  if (byUser) owner = { kind: "user", id: byUser.id };
  if (!owner) {
    const { data: byOrg } = await db.from("organizations").select("id").eq("paypal_subscription_id", subscriptionId).maybeSingle();
    if (byOrg) owner = { kind: "org", id: byOrg.id };
  }
  if (!owner) {
    const parsed = parseSubscriptionOwner(sub.custom_id);
    if (parsed && isUuid(parsed.id)) {
      const { data } = await db.from(parsed.kind === "org" ? "organizations" : "users").select("id").eq("id", parsed.id).maybeSingle();
      if (data) owner = parsed;
    }
  }
  if (!owner) return null;

  const { count } = await db.from("payments").select("id", { count: "exact", head: true })
    .eq("subscription_id", subscriptionId).eq("status", "completed");
  const mapped = mapSubscription(sub, { hasCompletedPayment: (count ?? 0) > 0 });

  const { data: plans } = await db.from("plans").select("code,prices,kind").in("kind", owner.kind === "org" ? ["business"] : ["subscription"]);
  const plan = (plans ?? []).find((p) =>
    Object.values(p.prices as Record<string, { paypal_plan_id?: string }>).some((x) => x?.paypal_plan_id === sub.plan_id),
  )?.code ?? null;

  const patch: Record<string, unknown> = { subscription_status: mapped.status, paypal_subscription_id: subscriptionId };
  if (mapped.periodStart) patch.current_period_start = mapped.periodStart;
  if (mapped.periodEnd) patch.current_period_end = mapped.periodEnd;
  if (sub.billing_info?.last_payment?.amount?.currency_code) patch.subscription_currency = sub.billing_info.last_payment.amount.currency_code;

  if (owner.kind === "user") {
    patch.subscription_plan = plan ?? "plus_monthly";
    patch.paypal_customer_id = sub.subscriber?.payer_id ?? null;
    await db.from("users").update(patch).eq("id", owner.id);
    return { owner, userId: owner.id, status: mapped.status };
  }
  if (plan) patch.plan_code = plan;
  await db.from("organizations").update(patch).eq("id", owner.id);
  return { owner, userId: null, status: mapped.status };
}
