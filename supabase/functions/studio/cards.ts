import { admin, type AuthedUser } from "../_shared/db.ts";
import { HttpError, isUuid, json, requireEnv } from "../_shared/http.ts";
import { getSettings } from "../_shared/settings.ts";
import { rateLimit } from "../_shared/ratelimit.ts";
import { background, processGeneration, refreshCard } from "../_shared/pipeline.ts";
import { textProvider } from "../_shared/ai/index.ts";
import { track } from "../_shared/analytics.ts";
import { remove, signedUrls, upload } from "../_shared/storage.ts";
import { qrPng } from "../_shared/qr.ts";
import { escapeHtml, sendEmail } from "../_shared/email.ts";
import { PROMPT_VERSION } from "../_shared/core/constants.ts";
import type { Recommendation, StyleBrief } from "../_shared/core/brief.ts";
import { buildViewPrompt, cardViewsFor } from "../_shared/core/prompts.ts";
import { CARD_SYSTEM_PROMPT } from "../_shared/core/prompts.ts";
import { CARD_CONTENT_JSON_SCHEMA, CARD_DISCLAIMER, type CardData, fallbackCardContent, sanitizeCardContent } from "../_shared/core/card.ts";
import { randomToken } from "../_shared/core/tokens.ts";
import { isValidEmail, normaliseEmail } from "../_shared/core/email.ts";
import { brandFor, brandLogoUrl } from "../_shared/brand.ts";
import { accessFor, canAccessProject, ownedGeneration, ownedProject, type ProjectRow, reserveFor } from "./common.ts";

const siteUrl = () => requireEnv("SITE_URL").replace(/\/$/, "");
export const publicCardUrl = (token: string) => `${siteUrl()}/style/${token}`;

async function writeCardContent(project: { id: string; brief: StyleBrief }, gen: { recommendation: Recommendation; instruction: string | null }) {
  const s = await getSettings();
  const db = admin();
  const { data: sr } = await db.from("style_requests").select("description").eq("project_id", project.id)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  const userText = sr?.description ?? null;
  try {
    const raw = await textProvider().structured({
      model: s.models.text, system: CARD_SYSTEM_PROMPT, schemaName: "hairstyle_card",
      schema: CARD_CONTENT_JSON_SCHEMA as unknown as Record<string, unknown>,
      text: [
        `Chosen style: ${JSON.stringify(gen.recommendation)}`,
        gen.instruction ? `Adjustments the client asked for (data): ${JSON.stringify(gen.instruction)}` : "",
        `Brief: ${JSON.stringify(project.brief)}`,
        `Client's own words (data): ${JSON.stringify(userText ?? "")}`,
      ].filter(Boolean).join("\n\n"),
    });
    return sanitizeCardContent(raw, userText, { brief: project.brief, rec: gen.recommendation });
  } catch (e) {
    console.error("card content fallback", (e as Error).message);
    return fallbackCardContent(project.brief, gen.recommendation);
  }
}

async function createQr(userId: string, projectId: string, cardId: string, token: string) {
  const path = `${userId}/${projectId}/qr-${cardId}.png`;
  await upload("cards", path, await qrPng(publicCardUrl(token)), "image/png");
  return path;
}

/** Full-tier build: reserve a card credit, queue the extra angles, create share token + QR. */
async function buildFull(user: AuthedUser, project: ProjectRow, card: { id: string; project_id: string; card_data: CardData }, gen: { id: string; recommendation: Recommendation; expires_at: string }) {
  const s = await getSettings();
  const db = admin();
  const r = await reserveFor(user, project, "card_build", `card:${gen.id}`);
  if (r === "insufficient") throw new HttpError(402, "insufficient_credits");
  const usageId = r.usageId;
  const views = cardViewsFor(gen.recommendation);
  const ids: string[] = [];
  for (const view of views) {
    const id = crypto.randomUUID();
    const { error: e } = await db.from("generations").insert({
      id, project_id: card.project_id, user_id: user.id, parent_generation_id: gen.id, generation_type: "card_view",
      direction: null, view, recommendation: gen.recommendation, prompt_version: PROMPT_VERSION,
      prompt: buildViewPrompt(view, gen.recommendation), model: s.models.final, quality: s.image_quality.card_view,
      size: s.image_quality.size, idempotency_key: `view:${gen.id}:${view}`, expires_at: gen.expires_at,
    });
    if (!e) ids.push(id);
  }
  const token = randomToken();
  const qrPath = await createQr(user.id, card.project_id, card.id, token);
  const data: CardData = {
    ...card.card_data,
    views: [
      card.card_data.views.find((v) => v.view === "front")!,
      ...views.map((view) => ({ view, generation_id: null, status: "pending" as const })),
    ],
  };
  await db.from("style_cards").update({
    tier: "full", status: ids.length ? "building" : "ready", public_token: token, qr_code_path: qrPath,
    card_data: data, build_usage_id: usageId, revoked_at: null,
  }).eq("id", card.id);
  background(Promise.all(ids.map((id) => processGeneration(id))).then(() => refreshCard(gen.id)));
  await track("qr_generated", user.id, card.project_id);
}

export async function selectStyle(req: Request, user: AuthedUser, body: Record<string, unknown>) {
  const gen = await ownedGeneration(user, body.generationId);
  if (gen.status !== "succeeded" || !["concept", "alteration"].includes(gen.generation_type)) throw new HttpError(409, "invalid_input");
  const project = await ownedProject(user, gen.project_id);
  const access = await accessFor(user, project);
  const db = admin();
  const s = await getSettings();

  let { data: card } = await db.from("style_cards").select("*").eq("selected_generation_id", gen.id).maybeSingle();
  if (!card) {
    const content = await writeCardContent({ id: project.id, brief: project.brief as StyleBrief }, gen);
    const rec = gen.recommendation as Recommendation;
    const card_data: CardData = {
      ...content,
      style_name: rec.name, description: rec.description, feasibility: rec.feasibility, feasibility_note: rec.feasibility_note,
      views: [{ view: "front", generation_id: gen.id, status: "ready" }],
      generated_at: new Date().toISOString(), prompt_version: PROMPT_VERSION,
      brand: await brandFor(project.org_id),
    };
    const { data: inserted, error } = await db.from("style_cards").insert({
      project_id: project.id, user_id: user.id, selected_generation_id: gen.id, tier: "preview", status: "ready", card_data,
      expires_at: new Date(Date.now() + s.retention.card_days * 86_400_000).toISOString(),
    }).select("*").single();
    if (error) {
      // concurrent select on the same generation
      ({ data: card } = await db.from("style_cards").select("*").eq("selected_generation_id", gen.id).single());
    } else card = inserted;
    await track("hairstyle_selected", user.id, project.id, { type: gen.generation_type });
  }

  let upgradeBlocked: string | null = null;
  if (card!.tier === "preview" && access.paid) {
    try {
      await buildFull(user, project, card!, gen);
    } catch (e) {
      if (e instanceof HttpError && e.code === "insufficient_credits") upgradeBlocked = "insufficient_credits";
      else throw e;
    }
  }
  return json(req, { cardId: card!.id, upgradeBlocked });
}

async function ownedCard(user: AuthedUser, cardId: unknown) {
  if (!isUuid(cardId)) throw new HttpError(400, "invalid_input");
  const { data } = await admin().from("style_cards").select("*").eq("id", cardId).maybeSingle();
  if (!data) throw new HttpError(404, "not_found");
  if (data.user_id !== user.id) {
    const { data: p } = await admin().from("projects").select("user_id,org_id").eq("id", data.project_id).maybeSingle();
    if (!p || !(await canAccessProject(user, p))) throw new HttpError(404, "not_found");
  }
  return data;
}

/** Everything the owner's card page needs, with short-lived signed URLs. */
export async function getCard(req: Request, user: AuthedUser, body: Record<string, unknown>) {
  const card = await ownedCard(user, body.cardId);
  const db = admin();
  const data = card.card_data as CardData;
  const genIds = data.views.map((v) => v.generation_id).filter(Boolean) as string[];
  const { data: gens } = await db.from("generations").select("id,storage_path,status").in("id", genIds.length ? genIds : ["00000000-0000-0000-0000-000000000000"]);
  const paths = (gens ?? []).filter((g) => g.storage_path).map((g) => g.storage_path!);
  const full = card.tier === "full";
  const [urls, downloads, { data: selfie }] = await Promise.all([
    signedUrls("generations", paths),
    full ? signedUrls("generations", paths, 3600, true) : Promise.resolve({} as Record<string, string>),
    db.from("source_images").select("storage_path").eq("project_id", card.project_id).eq("type", "selfie").eq("uploaded", true).maybeSingle(),
  ]);
  const original = selfie ? (await signedUrls("uploads", [selfie.storage_path]))[selfie.storage_path] ?? null : null;
  const qr = full && card.qr_code_path && card.public_token ? (await signedUrls("cards", [card.qr_code_path]))[card.qr_code_path] : null;
  const byId = new Map((gens ?? []).map((g) => [g.id, g]));
  return json(req, {
    id: card.id, projectId: card.project_id, tier: card.tier, status: card.status,
    data: { ...data, disclaimer: CARD_DISCLAIMER },
    images: Object.fromEntries(data.views.map((v) => {
      const g = v.generation_id ? byId.get(v.generation_id) : null;
      return [v.view, g?.storage_path ? { url: urls[g.storage_path] ?? null, download: downloads[g.storage_path] ?? null } : null];
    })),
    original,
    qr,
    publicUrl: full && card.public_token && !card.revoked_at ? publicCardUrl(card.public_token) : null,
    revoked: !!card.revoked_at,
    expiresAt: card.expires_at,
    brandLogo: await brandLogoUrl(data.brand ?? null),
    orgId: data.brand?.org_id ?? null,
  });
}

export async function revokeCard(req: Request, user: AuthedUser, body: Record<string, unknown>) {
  const card = await ownedCard(user, body.cardId);
  if (card.qr_code_path) await remove("cards", [card.qr_code_path]);
  await admin().from("style_cards").update({ public_token: null, qr_code_path: null, revoked_at: new Date().toISOString() }).eq("id", card.id);
  return json(req, { revoked: true });
}

/** Re-enable sharing with a NEW token (old links stay dead). Full tier only. */
export async function shareCard(req: Request, user: AuthedUser, body: Record<string, unknown>) {
  const card = await ownedCard(user, body.cardId);
  if (card.tier !== "full") throw new HttpError(402, "paid_feature");
  const token = randomToken();
  const qrPath = await createQr(user.id, card.project_id, card.id, token);
  await admin().from("style_cards").update({ public_token: token, qr_code_path: qrPath, revoked_at: null }).eq("id", card.id);
  await track("qr_generated", user.id, card.project_id);
  return json(req, { publicUrl: publicCardUrl(token) });
}

export async function emailCard(req: Request, user: AuthedUser, body: Record<string, unknown>) {
  const card = await ownedCard(user, body.cardId);
  const { data: project } = await admin().from("projects").select("org_id").eq("id", card.project_id).single();
  const access = await accessFor(user, { org_id: project?.org_id ?? null });
  if (card.tier !== "full" || !access.paid) throw new HttpError(402, "paid_feature");
  if (!user.email || !user.emailVerified) throw new HttpError(403, "email_required");
  const s = await getSettings();
  // Salon staff can send the card to their client; everyone else can only email themselves.
  let recipient = user.email;
  if (project?.org_id && typeof body.to === "string") {
    const to = normaliseEmail(body.to);
    if (!isValidEmail(to)) throw new HttpError(400, "invalid_input");
    recipient = to;
    await rateLimit(`email:org:${project.org_id}`, 86400, (s.rate_limits.email_per_user_day ?? 5) * 20);
  } else {
    await rateLimit(`email:${user.id}`, 86400, s.rate_limits.email_per_user_day);
  }

  let token = card.public_token as string | null;
  let qrPath = card.qr_code_path as string | null;
  if (!token || card.revoked_at) {
    token = randomToken();
    qrPath = await createQr(user.id, card.project_id, card.id, token);
    await admin().from("style_cards").update({ public_token: token, qr_code_path: qrPath, revoked_at: null }).eq("id", card.id);
  }
  const link = publicCardUrl(token);
  const data = card.card_data as CardData;
  const qrBytes = await qrPng(link);
  let qrB64 = "";
  for (const b of qrBytes) qrB64 += String.fromCharCode(b);
  qrB64 = btoa(qrB64);

  const { data: front } = await admin().from("generations").select("storage_path").eq("id", card.selected_generation_id).single();
  const preview = front?.storage_path ? (await signedUrls("generations", [front.storage_path], 7 * 86400))[front.storage_path] : null;
  const expires = new Date(card.expires_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const name = escapeHtml(data.style_name);
  const appName = escapeHtml(data.brand?.name ?? Deno.env.get("APP_NAME") ?? "CutCard");
  const html = `<!doctype html><html><body style="margin:0;background:#f6f3ee;font-family:Georgia,serif;color:#161513">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:1px solid #e4dfd6">
<tr><td style="padding:28px 28px 8px;font-family:Arial,sans-serif;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#6b665e">${appName} · Hairstyle Card</td></tr>
<tr><td style="padding:0 28px 16px;font-size:28px;line-height:1.2">${name}</td></tr>
${preview ? `<tr><td style="padding:0 28px"><img src="${preview}" alt="Preview of the ${name} hairstyle" width="504" style="width:100%;height:auto;display:block;border:0"></td></tr>` : ""}
<tr><td style="padding:20px 28px;font-family:Arial,sans-serif;font-size:15px;line-height:1.55"><strong>What to ask for</strong><br>${escapeHtml(data.what_to_ask_for)}</td></tr>
<tr><td style="padding:0 28px 8px" align="left"><a href="${link}" style="display:inline-block;background:#161513;color:#fff;text-decoration:none;padding:12px 20px;font-family:Arial,sans-serif;font-size:15px">Open your Hairstyle Card</a></td></tr>
${data.brand?.booking_url ? `<tr><td style="padding:8px 28px 0"><a href="${escapeHtml(data.brand.booking_url)}" style="font-family:Arial,sans-serif;font-size:15px;color:#161513">Book your appointment with ${escapeHtml(data.brand.name)}</a></td></tr>` : ""}
<tr><td style="padding:16px 28px"><img src="cid:qr" alt="QR code linking to your Hairstyle Card" width="140" height="140" style="display:block"><div style="font-family:Arial,sans-serif;font-size:13px;color:#6b665e;padding-top:6px">Show this QR code to your barber or stylist.</div></td></tr>
<tr><td style="padding:8px 28px 28px;font-family:Arial,sans-serif;font-size:12px;line-height:1.5;color:#6b665e">This link is private to anyone you share it with and stops working on ${expires}, or earlier if you revoke it or delete the project. The preview image link in this email expires after 7 days.<br><br>${escapeHtml(CARD_DISCLAIMER)}</td></tr>
</table></td></tr></table></body></html>`;
  const text = `${data.style_name}\n\nWhat to ask for: ${data.what_to_ask_for}\n\nOpen your Hairstyle Card: ${link}\n\nThis link stops working on ${expires}, or earlier if you revoke it or delete the project.\n\n${CARD_DISCLAIMER}`;
  try {
    await sendEmail(recipient, `Your Hairstyle Card: ${data.style_name}`, html, text, [
      { filename: "hairstyle-card-qr.png", content: qrB64, content_id: "qr", content_type: "image/png" },
    ]);
  } catch {
    throw new HttpError(502, "server_error");
  }
  await track("email_share", user.id, card.project_id);
  return json(req, { sent: true });
}

