import { admin } from "./db.ts";

export interface Settings {
  limits: { free_generations: number; paid_generations: number; paid_alterations: number; card_builds_per_period: number; max_reference_images: number; max_upload_mb: number; min_image_px: number };
  models: { text: string; explore: string; final: string };
  image_quality: { free: string; paid: string; alteration: string; card_view: string; size: string };
  retention: { source_image_days: number; generation_days: number; saved_project_days: number; card_days: number; analytics_days: number };
  rate_limits: Record<string, number>;
  features: { watermark_free: boolean; require_email_before_generation: boolean; block_disposable_email: boolean };
  cost_estimates_usd: { text_call: number; image: Record<string, number> };
}

const DEFAULTS: Settings = {
  limits: { free_generations: 3, paid_generations: 7, paid_alterations: 2, card_builds_per_period: 3, max_reference_images: 3, max_upload_mb: 10, min_image_px: 512 },
  models: { text: "gpt-5-mini", explore: "gpt-image-2.5-flare", final: "gpt-image-2.5-sunburst" },
  image_quality: { free: "medium", paid: "high", alteration: "high", card_view: "medium", size: "1024x1536" },
  retention: { source_image_days: 7, generation_days: 30, saved_project_days: 365, card_days: 90, analytics_days: 400 },
  rate_limits: {},
  features: { watermark_free: true, require_email_before_generation: true, block_disposable_email: true },
  cost_estimates_usd: { text_call: 0.003, image: { low: 0.008, medium: 0.018, high: 0.06, xhigh: 0.1, max: 0.22 } },
};

let cache: { at: number; value: Settings } | null = null;

export async function getSettings(): Promise<Settings> {
  if (cache && Date.now() - cache.at < 30_000) return cache.value;
  const { data } = await admin().from("app_settings").select("key,value");
  const merged = structuredClone(DEFAULTS) as unknown as Record<string, Record<string, unknown>>;
  for (const row of data ?? []) {
    merged[row.key] = { ...(merged[row.key] ?? {}), ...(row.value as Record<string, unknown>) };
  }
  // env overrides for models let ops switch provider models without a deploy of settings
  const s = merged as unknown as Settings;
  s.models.text = Deno.env.get("TEXT_MODEL") ?? s.models.text;
  s.models.explore = Deno.env.get("IMAGE_MODEL_EXPLORE") ?? s.models.explore;
  s.models.final = Deno.env.get("IMAGE_MODEL_FINAL") ?? s.models.final;
  cache = { at: Date.now(), value: s };
  return s;
}

export function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}
