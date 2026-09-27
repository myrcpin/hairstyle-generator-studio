// One-time pack fulfilment. Idempotent on the PayPal capture id, safe to call from
// both the return page (capture) and the PAYMENT.CAPTURE.COMPLETED webhook.
import { admin } from "./db.ts";
import { track } from "./analytics.ts";
import { requireEnv } from "./http.ts";
import { escapeHtml, sendEmail } from "./email.ts";

export interface PackPayment {
  userId: string;
  planCode: string;
  captureId: string;
  amount: string;
  currency: string;
  eventId?: string | null;
}

export async function fulfilPack(p: PackPayment): Promise<{ fulfilled: boolean; duplicate: boolean }> {
  const db = admin();
  const { data: plan } = await db.from("plans").select("*").eq("code", p.planCode).eq("kind", "one_time").maybeSingle();
  if (!plan) throw new Error("unknown_plan");

  const { data: payment, error } = await db.from("payments").insert({
    user_id: p.userId, paypal_event_id: p.eventId ?? null, transaction_id: p.captureId, plan_code: p.planCode, kind: "one_time",
    amount: Number(p.amount), currency: p.currency, status: "completed",
  }).select("id").single();
  if (error) {
    if (error.code === "23505") return { fulfilled: false, duplicate: true }; // already fulfilled
    throw new Error(`payment insert failed: ${error.message}`);
  }

  const days = plan.grant_days ?? plan.access_days ?? 60;
  await db.from("credit_grants").insert({
    user_id: p.userId, plan_code: p.planCode, payment_id: payment.id, source: "purchase",
    grants_access: !!plan.access_days, generations: plan.generations, alterations: plan.alterations, card_builds: plan.card_builds,
    expires_at: new Date(Date.now() + days * 86_400_000).toISOString(),
  });
  await track("pack_purchased", p.userId, null, { plan: p.planCode, currency: p.currency });

  // Referral: does this purchase qualify the person who invited this user?
  const { data: cfg } = await db.from("app_settings").select("value").eq("key", "referrals").maybeSingle();
  const qualifying = ((cfg?.value as { qualifying_plans?: string[] })?.qualifying_plans) ?? ["starter_pack"];
  if (qualifying.includes(p.planCode)) {
    const { data: r } = await db.rpc("qualify_referral", { p_referred: p.userId });
    const res = r as { qualified?: boolean; rewarded?: boolean; referrer?: string } | null;
    if (res?.qualified && res.referrer) {
      await track("referral_qualified", res.referrer, null);
      if (res.rewarded) {
        await track("referral_rewarded", res.referrer, null);
        await notifyReferrer(res.referrer).catch((e) => console.error("referrer email failed", (e as Error).message));
      }
    }
  }

  await sendSurveyInvite(p.userId).catch((e) => console.error("survey email failed", (e as Error).message));
  return { fulfilled: true, duplicate: false };
}

async function emailOf(userId: string): Promise<string | null> {
  const { data } = await admin().from("users").select("email,email_verified").eq("id", userId).maybeSingle();
  return data?.email && data.email_verified ? data.email : null;
}

function shell(appName: string, title: string, body: string, cta: { href: string; label: string }) {
  return `<!doctype html><html><body style="margin:0;background:#f6f3ee;font-family:Arial,sans-serif;color:#161513">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="520" style="max-width:520px;background:#fff;border:1px solid #e4dfd6"><tr><td style="padding:28px">
<div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#6b665e">${escapeHtml(appName)}</div>
<h1 style="font-family:Georgia,serif;font-weight:normal;font-size:28px;margin:8px 0 12px">${escapeHtml(title)}</h1>
<div style="font-size:15px;line-height:1.55">${body}</div>
<p style="margin:24px 0 0"><a href="${cta.href}" style="display:inline-block;background:#161513;color:#fff;text-decoration:none;padding:12px 20px">${escapeHtml(cta.label)}</a></p>
</td></tr></table></td></tr></table></body></html>`;
}

/** The "5 quick questions" email sent after a purchase (also shown in-app straight after checkout). */
export async function sendSurveyInvite(userId: string) {
  const to = await emailOf(userId);
  if (!to) return;
  const { count } = await admin().from("survey_completions").select("user_id", { count: "exact", head: true }).eq("user_id", userId);
  if (count) return;
  const site = requireEnv("SITE_URL").replace(/\/$/, "");
  const app = Deno.env.get("APP_NAME") ?? "CutCard";
  const { data: cfg } = await admin().from("app_settings").select("value").eq("key", "survey").maybeSingle();
  const reward = (cfg?.value as { reward_generations?: number })?.reward_generations ?? 0;
  const perk = reward > 0 ? ` As a thank-you, we'll add ${reward} extra style${reward > 1 ? "s" : ""} to your account.` : "";
  await sendEmail(to, "5 quick questions about your haircuts", shell(app, "Help us get your next cut right",
    `<p>Thanks for your purchase. Five tap-to-answer questions (about 20 seconds) help us tailor styles and cards to how you actually get your hair cut.${escapeHtml(perk)}</p><p style="color:#6b665e;font-size:13px">Optional. Answers are linked to your account, used only to improve the service, and deleted with your account.</p>`,
    { href: `${site}/survey`, label: "Answer 5 questions" }),
    `Thanks for your purchase. Answer 5 quick questions: ${site}/survey${perk}`);
}

async function notifyReferrer(userId: string) {
  const to = await emailOf(userId);
  if (!to) return;
  const site = requireEnv("SITE_URL").replace(/\/$/, "");
  const app = Deno.env.get("APP_NAME") ?? "CutCard";
  await sendEmail(to, "You've earned a free month of Plus", shell(app, "Three friends joined — enjoy a free month",
    "<p>Three friends you invited bought a Starter Pack, so we've added a month of Plus to your account: new styles, alterations, full Hairstyle Cards, downloads and QR sharing.</p>",
    { href: `${site}/account`, label: "See my account" }),
    `Three friends you invited bought a Starter Pack, so you've earned a free month of Plus. ${site}/account`);
}
