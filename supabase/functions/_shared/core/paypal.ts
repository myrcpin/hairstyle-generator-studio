// Pure PayPal mapping logic (network calls live in ../paypal.ts).

export type LocalSubscriptionStatus = "none" | "pending" | "active" | "past_due" | "suspended" | "cancelled" | "expired";

export interface PaypalSubscription {
  id: string;
  status: "APPROVAL_PENDING" | "APPROVED" | "ACTIVE" | "SUSPENDED" | "CANCELLED" | "EXPIRED" | string;
  custom_id?: string;
  plan_id?: string;
  start_time?: string;
  subscriber?: { payer_id?: string; email_address?: string };
  billing_info?: {
    last_payment?: { amount?: { value: string; currency_code: string }; time?: string };
    next_billing_time?: string;
    failed_payments_count?: number;
    outstanding_balance?: { value: string };
  };
}

/**
 * Maps PayPal's authoritative subscription object to our status.
 * "Activate only after confirmed payment": ACTIVE without any recorded payment stays pending
 * until PAYMENT.SALE.COMPLETED (or a later fetch shows last_payment).
 */
export function mapSubscription(sub: PaypalSubscription, opts: { hasCompletedPayment: boolean }): {
  status: LocalSubscriptionStatus;
  periodStart: string | null;
  periodEnd: string | null;
} {
  const paid = opts.hasCompletedPayment || !!sub.billing_info?.last_payment?.time;
  const periodStart = sub.billing_info?.last_payment?.time ?? null;
  const periodEnd = sub.billing_info?.next_billing_time ?? null;
  switch (sub.status) {
    case "ACTIVE": {
      const failed = (sub.billing_info?.failed_payments_count ?? 0) > 0 && Number(sub.billing_info?.outstanding_balance?.value ?? 0) > 0;
      if (!paid) return { status: "pending", periodStart, periodEnd };
      return { status: failed ? "past_due" : "active", periodStart, periodEnd };
    }
    case "APPROVAL_PENDING":
    case "APPROVED":
      return { status: "pending", periodStart, periodEnd };
    case "SUSPENDED":
      return { status: "suspended", periodStart, periodEnd };
    case "CANCELLED":
      return { status: "cancelled", periodStart, periodEnd };
    case "EXPIRED":
      return { status: "expired", periodStart, periodEnd };
    default:
      return { status: "pending", periodStart, periodEnd };
  }
}

export const HANDLED_WEBHOOK_EVENTS = [
  "BILLING.SUBSCRIPTION.ACTIVATED",
  "BILLING.SUBSCRIPTION.RE-ACTIVATED",
  "BILLING.SUBSCRIPTION.UPDATED",
  "BILLING.SUBSCRIPTION.CANCELLED",
  "BILLING.SUBSCRIPTION.SUSPENDED",
  "BILLING.SUBSCRIPTION.EXPIRED",
  "BILLING.SUBSCRIPTION.PAYMENT.FAILED",
  "PAYMENT.SALE.COMPLETED",
  "PAYMENT.SALE.REFUNDED",
  "PAYMENT.SALE.REVERSED",
  "PAYMENT.CAPTURE.COMPLETED",
] as const;

/** Extracts the subscription id a webhook resource refers to. */
export function subscriptionIdFromEvent(eventType: string, resource: Record<string, unknown>): string | null {
  if (eventType.startsWith("BILLING.SUBSCRIPTION.")) return typeof resource.id === "string" ? resource.id : null;
  if (eventType.startsWith("PAYMENT.SALE.")) return typeof resource.billing_agreement_id === "string" ? resource.billing_agreement_id : null;
  return null;
}

/** Builds the PayPal plan override so the configured price is what PayPal charges. */
export function planOverride(amount: string, currency: string) {
  return {
    billing_cycles: [{
      sequence: 1,
      total_cycles: 0,
      pricing_scheme: { fixed_price: { value: amount, currency_code: currency } },
    }],
  };
}

// ---------------------------------------------------------------------------
// One-time packs (PayPal Orders v2)
// ---------------------------------------------------------------------------

export interface CapturedOrder {
  id: string;
  status: string;
  purchase_units?: {
    reference_id?: string;
    payments?: { captures?: { id: string; status: string; custom_id?: string; amount?: { value: string; currency_code: string } }[] };
  }[];
}

/** Validates a captured order against what we sold. Never trust the redirect alone. */
export function verifyCapture(order: CapturedOrder, expected: { userId: string; planCode: string; amount: string; currency: string }):
  { ok: true; captureId: string } | { ok: false; reason: string } {
  if (order.status !== "COMPLETED") return { ok: false, reason: `order_${order.status?.toLowerCase?.() ?? "unknown"}` };
  const cap = order.purchase_units?.[0]?.payments?.captures?.[0];
  if (!cap || cap.status !== "COMPLETED") return { ok: false, reason: "capture_not_completed" };
  if (cap.custom_id !== `${expected.userId}:${expected.planCode}`) return { ok: false, reason: "custom_id_mismatch" };
  if (cap.amount?.currency_code !== expected.currency || Number(cap.amount?.value) !== Number(expected.amount)) return { ok: false, reason: "amount_mismatch" };
  return { ok: true, captureId: cap.id };
}

/** custom_id on subscriptions: "<userId>" for people, "org:<orgId>" for salons. */
export function parseSubscriptionOwner(customId: string | undefined): { kind: "user" | "org"; id: string } | null {
  if (!customId) return null;
  if (customId.startsWith("org:")) return { kind: "org", id: customId.slice(4) };
  return { kind: "user", id: customId };
}
