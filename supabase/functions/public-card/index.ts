// Public Hairstyle Card by unguessable token. Never exposes email or internal ids.
import { HttpError, json, readJson, serve } from "../_shared/http.ts";
import { admin } from "../_shared/db.ts";
import { ipHash, rateLimit } from "../_shared/ratelimit.ts";
import { signedUrls } from "../_shared/storage.ts";
import { getSettings } from "../_shared/settings.ts";
import { track } from "../_shared/analytics.ts";
import { isWellFormedToken } from "../_shared/core/tokens.ts";
import { CARD_DISCLAIMER, type CardData } from "../_shared/core/card.ts";
import { brandLogoUrl } from "../_shared/brand.ts";

serve(async (req) => {
  const body = req.method === "POST" ? await readJson(req) : Object.fromEntries(new URL(req.url).searchParams);
  const token = String(body.token ?? "");
  const s = await getSettings();
  await rateLimit(`card:${await ipHash(req)}`, 60, s.rate_limits.public_card_per_ip_minute);
  if (!isWellFormedToken(token)) throw new HttpError(404, "not_found");

  const db = admin();
  const { data: card } = await db.from("style_cards").select("*").eq("public_token", token).maybeSingle();
  if (!card || card.tier !== "full") throw new HttpError(404, "card_revoked");
  if (card.revoked_at) throw new HttpError(410, "card_revoked");
  if (new Date(card.expires_at) < new Date()) throw new HttpError(410, "card_expired");

  const data = card.card_data as CardData;
  const ids = data.views.map((v) => v.generation_id).filter(Boolean) as string[];
  const { data: gens } = await db.from("generations").select("id,storage_path").in("id", ids).eq("status", "succeeded");
  const urls = await signedUrls("generations", (gens ?? []).map((g) => g.storage_path!), 900);
  const byId = new Map((gens ?? []).map((g) => [g.id, urls[g.storage_path!] ?? null]));

  let original: string | null = null;
  if (card.share_original) {
    const { data: selfie } = await db.from("source_images").select("storage_path").eq("project_id", card.project_id).eq("type", "selfie").eq("uploaded", true).maybeSingle();
    if (selfie) original = (await signedUrls("uploads", [selfie.storage_path], 900))[selfie.storage_path] ?? null;
  }

  await db.from("style_cards").update({ view_count: (card.view_count ?? 0) + 1 }).eq("id", card.id);
  await track("qr_viewed", null, card.project_id);

  const { prompt_version: _pv, ...publicData } = data;
  return json(req, {
    data: {
      ...publicData,
      views: data.views.filter((v) => v.status === "ready").map((v) => ({ view: v.view, generation_id: null, status: v.status })),
      disclaimer: CARD_DISCLAIMER,
      brand: data.brand ? { name: data.brand.name, booking_url: data.brand.booking_url } : null,
    },
    images: Object.fromEntries(data.views.filter((v) => v.generation_id).map((v) => [v.view, { url: byId.get(v.generation_id!) ?? null, download: null }])),
    original,
    brandLogo: await brandLogoUrl(data.brand ?? null, 900),
    expiresAt: card.expires_at,
  });
}, { checkOrigin: false });
