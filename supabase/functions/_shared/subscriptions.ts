import { admin } from "./db.ts";
import { getSubscription } from "./paypal.ts";
import { mapSubscription } from "./core/paypal.ts";
import { isUuid } from "./http.ts";

/**
 * Pulls the authoritative subscription from PayPal and mirrors it onto the user.
 * Never trusts client-supplied status.
 */
export async function syncSubscription(subscriptionId: string): Promise<{ userId: string; status: string } | null> {
  const db = admin();
  const sub = await getSubscription(subscriptionId);
  if (!sub) throw new Error("paypal_fetch_failed");

  let userId: string | null = null;
  const { data: byId } = await db.from("users").select("id").eq("paypal_subscription_id", subscriptionId).maybeSingle();
  if (byId) userId = byId.id;
  else if (isUuid(sub.custom_id)) {
    const { data: byCustom } = await db.from("users").select("id").eq("id", sub.custom_id).maybeSingle();
    if (byCustom) userId = byCustom.id;
  }
  if (!userId) return null;

  const { count } = await db.from("payments").select("id", { count: "exact", head: true })
    .eq("subscription_id", subscriptionId).eq("status", "completed");
  const mapped = mapSubscription(sub, { hasCompletedPayment: (count ?? 0) > 0 });

  const { data: plans } = await db.from("plans").select("code,prices").eq("kind", "subscription");
  const plan = (plans ?? []).find((p) =>
    Object.values(p.prices as Record<string, { paypal_plan_id?: string }>).some((x) => x?.paypal_plan_id === sub.plan_id),
  )?.code ?? "plus_monthly";

  const patch: Record<string, unknown> = {
    subscription_status: mapped.status,
    subscription_plan: plan,
    paypal_subscription_id: subscriptionId,
    paypal_customer_id: sub.subscriber?.payer_id ?? null,
  };
  if (mapped.periodStart) patch.current_period_start = mapped.periodStart;
  if (mapped.periodEnd) patch.current_period_end = mapped.periodEnd;
  if (sub.billing_info?.last_payment?.amount?.currency_code) patch.subscription_currency = sub.billing_info.last_payment.amount.currency_code;
  await db.from("users").update(patch).eq("id", userId);
  return { userId, status: mapped.status };
}
