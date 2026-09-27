import { HttpError, isUuid, json, readJson, requireEnv, serve } from "../_shared/http.ts";
import { admin, type AuthedUser, getAllowance, requireUser } from "../_shared/db.ts";
import { paypal } from "../_shared/paypal.ts";
import { syncSubscription } from "../_shared/subscriptions.ts";
import { fulfilPack } from "../_shared/fulfilment.ts";
import { track } from "../_shared/analytics.ts";
import { rateLimit } from "../_shared/ratelimit.ts";
import { isCurrency } from "../_shared/core/pricing.ts";
import { type CapturedOrder, planOverride, verifyCapture } from "../_shared/core/paypal.ts";
import { isDisposableEmail } from "../_shared/core/email.ts";

type Price = { amount: string; paypal_plan_id: string | null };

function requireBuyer(user: AuthedUser) {
  if (!user.email || !user.emailVerified) throw new HttpError(403, "email_required");
  if (isDisposableEmail(user.email)) throw new HttpError(403, "disposable_email");
}

async function ownedOrg(userId: string, orgId: unknown, ownerOnly = true) {
  if (!isUuid(orgId)) throw new HttpError(400, "invalid_input");
  const { data: m } = await admin().from("organization_members").select("role").eq("org_id", orgId).eq("user_id", userId).maybeSingle();
  if (!m || (ownerOnly && m.role !== "owner")) throw new HttpError(403, "forbidden");
  const { data: org } = await admin().from("organizations").select("*").eq("id", orgId).single();
  return org!;
}

serve(async (req) => {
  if (req.method !== "POST") throw new HttpError(405, "invalid_input");
  const body = await readJson(req);
  const user = await requireUser(req);
  const db = admin();
  const site = () => requireEnv("SITE_URL").replace(/\/$/, "");
  const brand = Deno.env.get("APP_NAME") ?? "CutCard";

  switch (body.action) {
    // ------------------------------------------------------------------ Plus / Salon subscriptions
    case "create_subscription": {
      requireBuyer(user);
      await rateLimit(`checkout:${user.id}`, 3600, 10);
      const currency = isCurrency(body.currency) ? body.currency : "GBP";
      const isOrg = body.orgId !== undefined;
      const org = isOrg ? await ownedOrg(user.id, body.orgId) : null;
      const planCode = typeof body.plan === "string" ? body.plan : "plus_monthly";
      const { data: plan } = await db.from("plans").select("*").eq("code", planCode).eq("kind", isOrg ? "business" : "subscription").eq("active", true).maybeSingle();
      const price = (plan?.prices as Record<string, Price> | undefined)?.[currency];
      if (!plan || !price?.paypal_plan_id) throw new HttpError(503, "service_unavailable");

      if (!isOrg) {
        const allowance = await getAllowance(user.id);
        if (allowance.subscribed && allowance.subscription_status === "active") return json(req, { alreadyActive: true });
      } else if (org!.subscription_status === "active") return json(req, { alreadyActive: true });

      const { status, body: sub } = await paypal<{ id: string; links: { rel: string; href: string }[] }>("/v1/billing/subscriptions", {
        method: "POST",
        idempotencyKey: `sub-${isOrg ? org!.id : user.id}-${planCode}-${currency}-${new Date().toISOString().slice(0, 13)}`,
        body: JSON.stringify({
          plan_id: price.paypal_plan_id,
          plan: planOverride(price.amount, currency), // charge exactly the admin-configured price
          custom_id: isOrg ? `org:${org!.id}` : user.id,
          application_context: {
            brand_name: brand, user_action: "SUBSCRIBE_NOW", shipping_preference: "NO_SHIPPING",
            return_url: isOrg ? `${site()}/business/dashboard?billing=return` : `${site()}/billing/return`,
            cancel_url: isOrg ? `${site()}/business/dashboard?billing=cancelled` : `${site()}/pricing?cancelled=1`,
          },
        }),
      });
      const approve = sub.links?.find((l) => l.rel === "approve")?.href;
      if (status >= 300 || !approve) throw new HttpError(502, "payment_failed");
      if (isOrg) {
        await db.from("organizations").update({ paypal_subscription_id: sub.id, subscription_status: "pending", plan_code: plan.code, subscription_currency: currency })
          .eq("id", org!.id).neq("subscription_status", "active");
      } else {
        await db.from("users").update({ paypal_subscription_id: sub.id, subscription_status: "pending", subscription_plan: plan.code, subscription_currency: currency })
          .eq("id", user.id).not("subscription_status", "in", "(active)");
      }
      await track("checkout_started", user.id, null, { currency, plan: plan.code });
      return json(req, { approveUrl: approve, subscriptionId: sub.id });
    }

    case "confirm": {
      // After PayPal redirects back we ask PayPal directly; the client's word counts for nothing.
      const isOrg = body.orgId !== undefined;
      const owner = isOrg ? await ownedOrg(user.id, body.orgId) : (await db.from("users").select("paypal_subscription_id").eq("id", user.id).single()).data;
      const subId = owner?.paypal_subscription_id;
      if (!subId || (typeof body.subscriptionId === "string" && body.subscriptionId !== subId)) throw new HttpError(403, "forbidden");
      const result = await syncSubscription(subId);
      if (!result || (isOrg ? result.owner.id !== body.orgId : result.userId !== user.id)) throw new HttpError(403, "forbidden");
      if (result.status === "active") await track("subscription_completed", user.id, null, { via: "return", org: isOrg });
      return json(req, { status: result.status, allowance: isOrg ? null : await getAllowance(user.id) });
    }

    case "cancel": {
      const isOrg = body.orgId !== undefined;
      const owner = isOrg ? await ownedOrg(user.id, body.orgId) : (await db.from("users").select("paypal_subscription_id").eq("id", user.id).single()).data;
      if (!owner?.paypal_subscription_id) throw new HttpError(404, "not_found");
      const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.slice(0, 120) : "Cancelled by user";
      const { status } = await paypal(`/v1/billing/subscriptions/${encodeURIComponent(owner.paypal_subscription_id)}/cancel`, {
        method: "POST", body: JSON.stringify({ reason }),
      });
      if (status !== 204 && status !== 422 /* already cancelled */) throw new HttpError(502, "server_error");
      await syncSubscription(owner.paypal_subscription_id);
      await track("subscription_cancelled", user.id, null, { org: isOrg });
      return json(req, { allowance: isOrg ? null : await getAllowance(user.id) });
    }

    // ------------------------------------------------------------------ One-time packs (PayPal Orders v2)
    case "buy_pack": {
      requireBuyer(user);
      await rateLimit(`checkout:${user.id}`, 3600, 10);
      const currency = isCurrency(body.currency) ? body.currency : "GBP";
      const planCode = typeof body.plan === "string" ? body.plan : "starter_pack";
      const { data: plan } = await db.from("plans").select("*").eq("code", planCode).eq("kind", "one_time").eq("active", true).maybeSingle();
      const price = (plan?.prices as Record<string, Price> | undefined)?.[currency];
      if (!plan || !price?.amount) throw new HttpError(503, "service_unavailable");
      const { status, body: order } = await paypal<{ id: string; links: { rel: string; href: string }[] }>("/v2/checkout/orders", {
        method: "POST",
        idempotencyKey: `order-${user.id}-${planCode}-${currency}-${new Date().toISOString().slice(0, 15)}`,
        body: JSON.stringify({
          intent: "CAPTURE",
          purchase_units: [{
            reference_id: plan.code,
            custom_id: `${user.id}:${plan.code}`,
            description: `${brand} ${plan.name}`,
            amount: { currency_code: currency, value: price.amount },
          }],
          payment_source: { paypal: { experience_context: {
            brand_name: brand, user_action: "PAY_NOW", shipping_preference: "NO_SHIPPING",
            return_url: `${site()}/billing/pack-return`, cancel_url: `${site()}/pricing?cancelled=1`,
          } } },
        }),
      });
      const approve = order.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href;
      if (status >= 300 || !approve) throw new HttpError(502, "payment_failed");
      await track("checkout_started", user.id, null, { currency, plan: plan.code });
      return json(req, { approveUrl: approve, orderId: order.id });
    }

    case "capture_pack": {
      // PayPal returns ?token=<orderId>. We capture server-side and verify amount + owner before granting anything.
      const orderId = typeof body.orderId === "string" && /^[A-Z0-9]{8,30}$/.test(body.orderId) ? body.orderId : null;
      if (!orderId) throw new HttpError(400, "invalid_input");
      const { body: current } = await paypal<CapturedOrder>(`/v2/checkout/orders/${orderId}`);
      const planCode = current.purchase_units?.[0]?.reference_id ?? "starter_pack";
      const { data: plan } = await db.from("plans").select("*").eq("code", planCode).eq("kind", "one_time").maybeSingle();
      if (!plan) throw new HttpError(400, "invalid_input");
      let order = current;
      if (current.status === "APPROVED") {
        const r = await paypal<CapturedOrder>(`/v2/checkout/orders/${orderId}/capture`, { method: "POST", idempotencyKey: `capture-${orderId}`, body: "{}" });
        order = r.body;
      }
      const currency = order.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.currency_code ?? "";
      const price = (plan.prices as Record<string, Price>)[currency];
      const check = verifyCapture(order, { userId: user.id, planCode, amount: price?.amount ?? "-1", currency });
      if (!check.ok) {
        console.error("capture rejected", check.reason);
        throw new HttpError(402, "payment_pending_capture");
      }
      const result = await fulfilPack({ userId: user.id, planCode, captureId: check.captureId, amount: price.amount, currency });
      return json(req, { ok: true, duplicate: result.duplicate, allowance: await getAllowance(user.id) });
    }

    case "status":
      return json(req, await getAllowance(user.id));

    default:
      throw new HttpError(400, "invalid_input");
  }
});
