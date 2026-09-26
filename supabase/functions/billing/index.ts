import { HttpError, json, readJson, requireEnv, serve } from "../_shared/http.ts";
import { admin, getAllowance, requireUser } from "../_shared/db.ts";
import { paypal } from "../_shared/paypal.ts";
import { syncSubscription } from "../_shared/subscriptions.ts";
import { track } from "../_shared/analytics.ts";
import { rateLimit } from "../_shared/ratelimit.ts";
import { isCurrency } from "../_shared/core/pricing.ts";
import { planOverride } from "../_shared/core/paypal.ts";
import { isDisposableEmail } from "../_shared/core/email.ts";

serve(async (req) => {
  if (req.method !== "POST") throw new HttpError(405, "invalid_input");
  const body = await readJson(req);
  const user = await requireUser(req);
  const db = admin();

  switch (body.action) {
    case "create_subscription": {
      if (!user.email || !user.emailVerified) throw new HttpError(403, "email_required");
      if (isDisposableEmail(user.email)) throw new HttpError(403, "disposable_email");
      await rateLimit(`checkout:${user.id}`, 3600, 10);
      const currency = isCurrency(body.currency) ? body.currency : "GBP";
      const allowance = await getAllowance(user.id);
      if (allowance.paid && allowance.subscription_status === "active") return json(req, { alreadyActive: true });

      const planCode = typeof body.plan === "string" ? body.plan : "plus_monthly";
      const { data: plan } = await db.from("plans").select("*").eq("code", planCode).eq("kind", "subscription").eq("active", true).maybeSingle();
      const price = (plan?.prices as Record<string, { amount: string; paypal_plan_id: string | null }> | undefined)?.[currency];
      if (!plan || !price?.paypal_plan_id) throw new HttpError(503, "service_unavailable");

      const site = requireEnv("SITE_URL").replace(/\/$/, "");
      const { status, body: sub } = await paypal<{ id: string; links: { rel: string; href: string }[] }>("/v1/billing/subscriptions", {
        method: "POST",
        idempotencyKey: `sub-${user.id}-${currency}-${new Date().toISOString().slice(0, 13)}`,
        body: JSON.stringify({
          plan_id: price.paypal_plan_id,
          // Charge exactly the admin-configured price (must match the plan's currency).
          plan: planOverride(price.amount, currency),
          custom_id: user.id,
          application_context: {
            brand_name: Deno.env.get("APP_NAME") ?? "CutCard",
            user_action: "SUBSCRIBE_NOW",
            shipping_preference: "NO_SHIPPING",
            return_url: `${site}/billing/return`,
            cancel_url: `${site}/pricing?cancelled=1`,
          },
        }),
      });
      const approve = sub.links?.find((l) => l.rel === "approve")?.href;
      if (status >= 300 || !approve) throw new HttpError(502, "payment_failed");
      await db.from("users").update({ paypal_subscription_id: sub.id, subscription_status: "pending", subscription_plan: plan.code, subscription_currency: currency })
        .eq("id", user.id).not("subscription_status", "in", "(active)");
      await track("checkout_started", user.id, null, { currency });
      return json(req, { approveUrl: approve, subscriptionId: sub.id });
    }

    case "confirm": {
      // Called after PayPal redirects back. We ask PayPal directly; the client's word counts for nothing.
      const { data: profile } = await db.from("users").select("paypal_subscription_id").eq("id", user.id).single();
      const subId = typeof body.subscriptionId === "string" ? body.subscriptionId : profile?.paypal_subscription_id;
      if (!subId || subId !== profile?.paypal_subscription_id) throw new HttpError(403, "forbidden");
      const result = await syncSubscription(subId);
      if (!result || result.userId !== user.id) throw new HttpError(403, "forbidden");
      if (result.status === "active") await track("subscription_completed", user.id, null, { via: "return" });
      return json(req, { status: result.status, allowance: await getAllowance(user.id) });
    }

    case "cancel": {
      const { data: profile } = await db.from("users").select("paypal_subscription_id,subscription_status").eq("id", user.id).single();
      if (!profile?.paypal_subscription_id) throw new HttpError(404, "not_found");
      const { status } = await paypal(`/v1/billing/subscriptions/${encodeURIComponent(profile.paypal_subscription_id)}/cancel`, {
        method: "POST", body: JSON.stringify({ reason: typeof body.reason === "string" ? body.reason.slice(0, 120) || "Cancelled by user" : "Cancelled by user" }),
      });
      if (status !== 204 && status !== 422 /* already cancelled */) throw new HttpError(502, "server_error");
      await syncSubscription(profile.paypal_subscription_id);
      await track("subscription_cancelled", user.id, null);
      return json(req, { allowance: await getAllowance(user.id) });
    }

    case "status":
      return json(req, await getAllowance(user.id));

    default:
      throw new HttpError(400, "invalid_input");
  }
});
