// Minimal first-party analytics. Whitelisted events only; no IPs, emails or free text stored.
import { HttpError, json, readJson, serve, isUuid } from "../_shared/http.ts";
import { admin, getUser } from "../_shared/db.ts";
import { ipHash, rateLimit } from "../_shared/ratelimit.ts";
import { getSettings } from "../_shared/settings.ts";
import { isAnalyticsEvent } from "../_shared/core/constants.ts";

// Events the browser may report. Everything credit/payment related is tracked server-side only.
const CLIENT_EVENTS = new Set(["landing_viewed", "upload_started", "email_submitted", "email_verified", "paywall_viewed", "download"]);

serve(async (req) => {
  if (req.method !== "POST") throw new HttpError(405, "invalid_input");
  const s = await getSettings();
  await rateLimit(`track:${await ipHash(req)}`, 60, s.rate_limits.track_per_ip_minute);
  const body = await readJson(req, 4000);
  if (!isAnalyticsEvent(body.event) || !CLIENT_EVENTS.has(body.event)) throw new HttpError(400, "invalid_input");
  const user = await getUser(req, { optional: true });
  const anonId = typeof body.anonId === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(body.anonId) ? body.anonId : null;
  const props: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries((body.props ?? {}) as Record<string, unknown>).slice(0, 8)) {
    if (/^[a-z_]{1,30}$/.test(k) && (typeof v === "number" || typeof v === "boolean" || (typeof v === "string" && v.length <= 40))) props[k] = v;
  }
  await admin().from("analytics_events").insert({
    event: body.event, user_id: user?.id ?? null, anon_id: anonId, project_id: isUuid(body.projectId) ? body.projectId : null, props,
  });
  return json(req, { ok: true });
});
