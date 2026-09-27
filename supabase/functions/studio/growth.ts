// Post-purchase survey and referral actions.
import { admin, type AuthedUser } from "../_shared/db.ts";
import { HttpError, json, requireEnv } from "../_shared/http.ts";
import { track } from "../_shared/analytics.ts";
import { type SurveyQuestion, validateAnswers } from "../_shared/core/survey.ts";
import { newReferralCode, normaliseReferralCode, referralProgress } from "../_shared/core/referral.ts";

async function surveyEligible(userId: string): Promise<{ eligible: boolean; currency: string | null }> {
  const db = admin();
  const { data: pay } = await db.from("payments").select("currency").eq("user_id", userId).eq("status", "completed")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (pay) return { eligible: true, currency: pay.currency };
  const { data: u } = await db.from("users").select("subscription_status,subscription_currency").eq("id", userId).single();
  return { eligible: u?.subscription_status === "active", currency: u?.subscription_currency ?? null };
}

async function activeQuestions(): Promise<SurveyQuestion[]> {
  const { data } = await admin().from("survey_questions").select("key,prompt,kind,options").eq("active", true).order("sort").limit(5);
  return (data ?? []) as SurveyQuestion[];
}

export async function getSurvey(req: Request, user: AuthedUser) {
  const [{ eligible, currency }, questions, { data: done }, { data: cfg }] = await Promise.all([
    surveyEligible(user.id),
    activeQuestions(),
    admin().from("survey_completions").select("completed_at").eq("user_id", user.id).maybeSingle(),
    admin().from("app_settings").select("value").eq("key", "survey").maybeSingle(),
  ]);
  return json(req, {
    eligible, completed: !!done, currency, questions,
    rewardGenerations: (cfg?.value as { reward_generations?: number })?.reward_generations ?? 0,
  });
}

export async function submitSurvey(req: Request, user: AuthedUser, body: Record<string, unknown>) {
  const db = admin();
  const { eligible, currency } = await surveyEligible(user.id);
  if (!eligible) throw new HttpError(403, "survey_not_eligible");
  const questions = await activeQuestions();
  const v = validateAnswers(questions, body.answers);
  if (!v.ok) throw new HttpError(400, "survey_incomplete", { missing: v.missing });

  const rows = Object.entries(v.answers).map(([question_key, answer]) => ({ user_id: user.id, question_key, answer, currency }));
  await db.from("survey_responses").upsert(rows, { onConflict: "user_id,question_key" });

  // Completion is recorded once; the thank-you reward is granted once.
  const { data: inserted } = await db.from("survey_completions").upsert({ user_id: user.id }, { onConflict: "user_id", ignoreDuplicates: true }).select("user_id");
  let rewarded = 0;
  if (inserted?.length) {
    const { data: cfg } = await db.from("app_settings").select("value").eq("key", "survey").maybeSingle();
    const c = (cfg?.value ?? {}) as { reward_generations?: number; reward_days?: number };
    if ((c.reward_generations ?? 0) > 0) {
      const { data: g } = await db.from("credit_grants").insert({
        user_id: user.id, source: "survey", generations: c.reward_generations,
        expires_at: new Date(Date.now() + (c.reward_days ?? 90) * 86_400_000).toISOString(),
      }).select("id").single();
      await db.from("survey_completions").update({ reward_grant_id: g?.id }).eq("user_id", user.id);
      rewarded = c.reward_generations!;
    }
    await track("survey_completed", user.id, null);
  }
  return json(req, { ok: true, rewarded });
}

async function referralConfig() {
  const { data } = await admin().from("app_settings").select("value").eq("key", "referrals").maybeSingle();
  const v = (data?.value ?? {}) as Record<string, number>;
  return { perReward: v.friends_per_reward ?? 3, maxRewards: v.max_rewards ?? 3, attachWindowDays: v.attach_window_days ?? 14 };
}

export async function getReferral(req: Request, user: AuthedUser) {
  if (!user.email || !user.emailVerified) throw new HttpError(403, "email_required");
  const db = admin();
  let { data: row } = await db.from("referral_codes").select("code").eq("user_id", user.id).maybeSingle();
  for (let i = 0; !row && i < 5; i++) {
    const { data, error } = await db.from("referral_codes").insert({ user_id: user.id, code: newReferralCode() }).select("code").single();
    if (!error) row = data;
  }
  if (!row) throw new HttpError(500, "server_error");
  const [{ count: joined }, { count: qualified }, { count: rewards }, cfg] = await Promise.all([
    db.from("referrals").select("id", { count: "exact", head: true }).eq("referrer_id", user.id),
    db.from("referrals").select("id", { count: "exact", head: true }).eq("referrer_id", user.id).eq("status", "qualified"),
    db.from("referral_rewards").select("id", { count: "exact", head: true }).eq("referrer_id", user.id),
    referralConfig(),
  ]);
  const site = requireEnv("SITE_URL").replace(/\/$/, "");
  return json(req, {
    code: row.code, link: `${site}/?ref=${row.code}`, joined: joined ?? 0,
    ...referralProgress(qualified ?? 0, rewards ?? 0, cfg.perReward, cfg.maxRewards),
  });
}

/**
 * Links a newly verified account to the friend who invited them. Rules (anti-abuse):
 * new account (window), no purchases yet, not already referred, not self, not the same browser/device as the referrer.
 * (Same Wi-Fi is allowed on purpose: flatmates and colleagues are exactly who people share with.)
 * The reward only triggers on a real purchase by the friend, so fake accounts cost real money.
 */
export async function attachReferral(req: Request, user: AuthedUser, body: Record<string, unknown>) {
  if (!user.email || !user.emailVerified) throw new HttpError(403, "email_required");
  const code = normaliseReferralCode(body.code);
  if (!code) throw new HttpError(400, "referral_invalid");
  const db = admin();
  const { data: owner } = await db.from("referral_codes").select("user_id").eq("code", code).maybeSingle();
  if (!owner) throw new HttpError(404, "referral_invalid");
  if (owner.user_id === user.id) throw new HttpError(400, "referral_not_eligible");

  const cfg = await referralConfig();
  const [{ data: me }, { data: referrer }, { count: purchases }, { data: existing }] = await Promise.all([
    db.from("users").select("created_at,device_hash").eq("id", user.id).single(),
    db.from("users").select("device_hash").eq("id", owner.user_id).single(),
    db.from("payments").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("status", "completed"),
    db.from("referrals").select("id").eq("referred_user_id", user.id).maybeSingle(),
  ]);
  if (existing) return json(req, { attached: false, reason: "already_referred" });
  const tooOld = me && Date.now() - new Date(me.created_at).getTime() > cfg.attachWindowDays * 86_400_000;
  const sameDevice = !!(me?.device_hash && me.device_hash === referrer?.device_hash);
  if (tooOld || (purchases ?? 0) > 0 || sameDevice) throw new HttpError(400, "referral_not_eligible");

  const { error } = await db.from("referrals").insert({ referrer_id: owner.user_id, referred_user_id: user.id });
  if (error) return json(req, { attached: false, reason: "already_referred" });
  await track("referral_attached", owner.user_id, null);
  return json(req, { attached: true });
}
