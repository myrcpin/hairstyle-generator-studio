import { describe, expect, it } from "vitest";
import { validateAnswers, type SurveyQuestion } from "../../supabase/functions/_shared/core/survey.ts";
import { newReferralCode, normaliseReferralCode, referralProgress } from "../../supabase/functions/_shared/core/referral.ts";
import { parseSubscriptionOwner, verifyCapture } from "../../supabase/functions/_shared/core/paypal.ts";

const qs: SurveyQuestion[] = [
  { key: "cut_frequency", prompt: "How often?", kind: "single_choice", options: [{ value: "5_8_weeks", label: "5–8 weeks" }, { value: "less_often", label: "Less often" }] },
  { key: "left_unhappy", prompt: "Unhappy?", kind: "yes_no", options: [] },
];

describe("survey validation", () => {
  it("accepts one valid answer per active question", () => {
    expect(validateAnswers(qs, { cut_frequency: "5_8_weeks", left_unhappy: "yes", extra: "ignored" }))
      .toEqual({ ok: true, answers: { cut_frequency: "5_8_weeks", left_unhappy: "yes" } });
  });
  it("rejects missing or invented options", () => {
    expect(validateAnswers(qs, { cut_frequency: "weekly", left_unhappy: "maybe" })).toEqual({ ok: false, missing: ["cut_frequency", "left_unhappy"] });
    expect(validateAnswers(qs, null)).toEqual({ ok: false, missing: ["cut_frequency", "left_unhappy"] });
  });
});

describe("referrals", () => {
  it("generates unambiguous codes and normalises input", () => {
    const c = newReferralCode();
    expect(c).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(normaliseReferralCode(` ${c.toLowerCase()} `)).toBe(c);
    expect(normaliseReferralCode("bad code!")).toBeNull();
  });
  it("reports progress towards the next free month and the cap", () => {
    expect(referralProgress(2, 0, 3, 3)).toMatchObject({ inCycle: 2, capped: false });
    expect(referralProgress(4, 1, 3, 3)).toMatchObject({ inCycle: 1, rewards: 1 });
    expect(referralProgress(10, 3, 3, 3)).toMatchObject({ inCycle: 3, capped: true });
  });
});

describe("pack capture verification", () => {
  const order = (over: Record<string, unknown> = {}) => ({
    id: "O1", status: "COMPLETED",
    purchase_units: [{ reference_id: "starter_pack", payments: { captures: [{ id: "C1", status: "COMPLETED", custom_id: "u1:starter_pack", amount: { value: "2.99", currency_code: "GBP" }, ...over }] } }],
  });
  const expected = { userId: "u1", planCode: "starter_pack", amount: "2.99", currency: "GBP" };
  it("accepts a matching completed capture", () => {
    expect(verifyCapture(order(), expected)).toEqual({ ok: true, captureId: "C1" });
  });
  it("rejects wrong owner, amount, currency or status", () => {
    expect(verifyCapture(order({ custom_id: "someone-else:starter_pack" }), expected).ok).toBe(false);
    expect(verifyCapture(order({ amount: { value: "0.01", currency_code: "GBP" } }), expected).ok).toBe(false);
    expect(verifyCapture(order({ amount: { value: "2.99", currency_code: "USD" } }), expected).ok).toBe(false);
    expect(verifyCapture(order({ status: "PENDING" }), expected).ok).toBe(false);
    expect(verifyCapture({ ...order(), status: "APPROVED" }, expected).ok).toBe(false);
  });
  it("distinguishes salon from personal subscriptions", () => {
    expect(parseSubscriptionOwner("org:abc")).toEqual({ kind: "org", id: "abc" });
    expect(parseSubscriptionOwner("u1")).toEqual({ kind: "user", id: "u1" });
    expect(parseSubscriptionOwner(undefined)).toBeNull();
  });
});
