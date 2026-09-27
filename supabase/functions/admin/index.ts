import { HttpError, json, readJson, serve } from "../_shared/http.ts";
import { admin, requireUser } from "../_shared/db.ts";

const EDITABLE_SETTINGS = ["limits", "models", "image_quality", "retention", "rate_limits", "features", "cost_estimates_usd", "referrals", "survey"] as const;

function validSettingValue(key: string, value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (!/^[a-z0-9_]{1,40}$/.test(k)) return false;
    if (key === "models" || key === "image_quality") {
      if (typeof v !== "string" || !/^[A-Za-z0-9._x-]{1,60}$/.test(v)) return false;
    } else if (key === "referrals" && k === "qualifying_plans") {
      if (!Array.isArray(v) || !v.every((x) => typeof x === "string" && /^[a-z_]{2,40}$/.test(x))) return false;
    } else if (key === "features") {
      if (typeof v !== "boolean") return false;
    } else if (key === "cost_estimates_usd") {
      if (typeof v !== "number" && (typeof v !== "object" || v === null)) return false;
    } else if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1_000_000) return false;
  }
  return true;
}

serve(async (req) => {
  if (req.method !== "POST") throw new HttpError(405, "invalid_input");
  const user = await requireUser(req);
  const db = admin();
  const { data: me } = await db.from("users").select("is_admin").eq("id", user.id).single();
  if (!me?.is_admin) throw new HttpError(403, "forbidden");
  const body = await readJson(req);

  switch (body.action) {
    case "stats": {
      const { data, error } = await db.rpc("admin_stats");
      if (error) throw new HttpError(500, "server_error");
      const { data: growth } = await db.rpc("admin_growth_stats");
      const { data: failures } = await db.from("generations").select("error_code,generation_type,model,created_at")
        .eq("status", "failed").order("created_at", { ascending: false }).limit(20);
      return json(req, { stats: data, growth, recentFailures: failures ?? [] });
    }
    case "get_settings": {
      const [{ data: settings }, { data: plans }] = await Promise.all([
        db.from("app_settings").select("key,value,updated_at"),
        db.from("plans").select("*").order("created_at"),
      ]);
      return json(req, { settings, plans });
    }
    case "update_setting": {
      const key = String(body.key);
      if (!(EDITABLE_SETTINGS as readonly string[]).includes(key) || !validSettingValue(key, body.value)) throw new HttpError(400, "invalid_input");
      await db.from("app_settings").upsert({ key, value: body.value, updated_at: new Date().toISOString(), updated_by: user.id });
      return json(req, { ok: true });
    }
    case "update_plan": {
      const code = String(body.code);
      const p = (body.plan ?? {}) as Record<string, unknown>;
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      for (const k of ["generations", "alterations", "card_builds", "grant_days"] as const) {
        if (p[k] !== undefined) {
          if (!Number.isInteger(p[k]) || (p[k] as number) < 0 || (p[k] as number) > 1000) throw new HttpError(400, "invalid_input");
          patch[k] = p[k];
        }
      }
      if (typeof p.active === "boolean") patch.active = p.active;
      if (typeof p.name === "string") patch.name = p.name.slice(0, 40);
      if (p.prices !== undefined) {
        const prices = p.prices as Record<string, { amount?: unknown; paypal_plan_id?: unknown }>;
        for (const [cur, v] of Object.entries(prices ?? {})) {
          if (!["GBP", "USD"].includes(cur) || typeof v?.amount !== "string" || !/^\d{1,4}\.\d{2}$/.test(v.amount)) throw new HttpError(400, "invalid_input");
          if (v.paypal_plan_id !== null && (typeof v.paypal_plan_id !== "string" || !/^P-[A-Z0-9]{10,40}$/.test(v.paypal_plan_id))) throw new HttpError(400, "invalid_input");
        }
        patch.prices = prices;
      }
      const { error } = await db.from("plans").update(patch).eq("code", code);
      if (error) throw new HttpError(400, "invalid_input");
      return json(req, { ok: true });
    }
    case "survey": {
      const { data, error } = await db.rpc("admin_survey_summary");
      if (error) throw new HttpError(500, "server_error");
      return json(req, data);
    }
    case "update_survey_question": {
      const key = String(body.key);
      const patch: Record<string, unknown> = {};
      if (typeof body.active === "boolean") patch.active = body.active;
      if (Number.isInteger(body.sort)) patch.sort = body.sort;
      if (body.active === true) {
        const { count } = await db.from("survey_questions").select("key", { count: "exact", head: true }).eq("active", true).neq("key", key);
        if ((count ?? 0) >= 5) return json(req, { error: { code: "invalid_input", message: "Only 5 questions can be active. Deactivate one first." } }, 400);
      }
      await db.from("survey_questions").update(patch).eq("key", key);
      return json(req, { ok: true });
    }
    case "survey_csv": {
      // Pseudonymised export: a stable per-export hash instead of user ids/emails.
      const { data } = await db.from("survey_responses").select("user_id,question_key,answer,currency,created_at").order("created_at").limit(50000);
      const salt = crypto.randomUUID();
      const hash = async (v: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt + v)))].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
      const lines = ["respondent,question,answer,currency,answered_at"];
      for (const r of data ?? []) lines.push([await hash(r.user_id), r.question_key, r.answer, r.currency ?? "", r.created_at].join(","));
      return json(req, { csv: lines.join("\n") });
    }
    default:
      throw new HttpError(400, "invalid_input");
  }
});
