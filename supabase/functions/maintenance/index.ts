// Scheduled job (hourly): privacy retention + recovery of stuck generations.
// Invoke with header "x-cron-secret: $CRON_SECRET" (see supabase/cron.sql).
import { json, requireEnv, serve } from "../_shared/http.ts";
import { admin } from "../_shared/db.ts";
import { remove } from "../_shared/storage.ts";
import { refreshCard, refreshProjectStatus } from "../_shared/pipeline.ts";
import { getSettings } from "../_shared/settings.ts";
import { messageFor } from "../_shared/core/errors.ts";

serve(async (req) => {
  const secret = requireEnv("CRON_SECRET");
  if (req.headers.get("x-cron-secret") !== secret) return new Response("forbidden", { status: 403 });
  const db = admin();
  const now = new Date().toISOString();
  const report: Record<string, number> = {};

  // 1. Stuck generations (worker died): fail + refund credits.
  const stuckBefore = new Date(Date.now() - 10 * 60_000).toISOString();
  const { data: stuck } = await db.from("generations").select("id,usage_id,project_id,generation_type,parent_generation_id")
    .in("status", ["queued", "processing"]).lt("created_at", stuckBefore).limit(500);
  for (const g of stuck ?? []) {
    await db.from("generations").update({ status: "failed", error_code: "generation_timeout", error_message: messageFor("generation_timeout"), completed_at: now }).eq("id", g.id);
    if (g.usage_id) await db.rpc("finalize_usage", { p_usage: g.usage_id, p_success: false });
    if (g.generation_type === "card_view" && g.parent_generation_id) await refreshCard(g.parent_generation_id);
    else await refreshProjectStatus(g.project_id);
  }
  report.stuck_failed = stuck?.length ?? 0;

  // 2. Source photos past retention.
  const { data: srcs } = await db.from("source_images").select("id,storage_path").lt("expires_at", now).limit(1000);
  await remove("uploads", (srcs ?? []).map((s) => s.storage_path));
  if (srcs?.length) await db.from("source_images").delete().in("id", srcs.map((s) => s.id));
  report.source_images_deleted = srcs?.length ?? 0;

  // 3. Generated images past retention (saved projects have extended expires_at).
  const { data: gens } = await db.from("generations").select("id,storage_path").lt("expires_at", now).not("storage_path", "is", null).limit(1000);
  await remove("generations", (gens ?? []).map((g) => g.storage_path!));
  if (gens?.length) await db.from("generations").update({ storage_path: null, status: "cancelled", error_code: "expired", error_message: messageFor("expired") }).in("id", gens.map((g) => g.id));
  report.generations_deleted = gens?.length ?? 0;

  // 4. Expired cards: remove QR, drop share token.
  const { data: cards } = await db.from("style_cards").select("id,qr_code_path").lt("expires_at", now).not("public_token", "is", null).limit(1000);
  await remove("cards", (cards ?? []).map((c) => c.qr_code_path!).filter(Boolean));
  if (cards?.length) await db.from("style_cards").update({ public_token: null, qr_code_path: null }).in("id", cards.map((c) => c.id));
  report.cards_expired = cards?.length ?? 0;

  // 5. Expired projects: mark expired (rows kept briefly for history; images are already gone).
  const { data: projects } = await db.from("projects").update({ status: "expired" }).lt("expires_at", now).neq("status", "expired").select("id");
  report.projects_expired = projects?.length ?? 0;

  // 6. Housekeeping: old rate-limit windows, old analytics.
  const s = await getSettings();
  await db.from("rate_limits").delete().lt("window_start", new Date(Date.now() - 2 * 86_400_000).toISOString());
  await db.from("analytics_events").delete().lt("created_at", new Date(Date.now() - s.retention.analytics_days * 86_400_000).toISOString());

  // 7. Anonymous users who never verified an email and are > 7 days old: delete (their photos too).
  const { data: anon } = await db.from("users").select("id").is("email", null).lt("created_at", new Date(Date.now() - 7 * 86_400_000).toISOString()).limit(200);
  for (const u of anon ?? []) {
    const { data: ps } = await db.from("projects").select("id").eq("user_id", u.id);
    for (const p of ps ?? []) {
      const { data: files } = await db.from("source_images").select("storage_path").eq("project_id", p.id);
      await remove("uploads", (files ?? []).map((f) => f.storage_path));
    }
    await db.auth.admin.deleteUser(u.id);
  }
  report.anonymous_users_deleted = anon?.length ?? 0;

  return json(req, report);
}, { checkOrigin: false });
