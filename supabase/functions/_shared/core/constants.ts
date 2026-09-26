// Pure, dependency-free constants shared by the browser (Vite) and Edge Functions (Deno).

export const PROMPT_VERSION = "2026-09-26.1";

export const DIRECTIONS = ["conservative", "balanced", "substantial"] as const;
export type Direction = (typeof DIRECTIONS)[number] | "extra";

export const CARD_VIEWS = ["front", "three_quarter", "side", "back", "tied_back"] as const;
export type CardView = (typeof CARD_VIEWS)[number];

export const VIEW_LABELS: Record<CardView, string> = {
  front: "Front",
  three_quarter: "3/4 view",
  side: "Side",
  back: "Back",
  tied_back: "Tied back",
};

export const CURRENT_LENGTHS = ["very_short", "short", "medium", "long"] as const;
export const DESIRED_LENGTHS = ["keep_similar", "slightly_shorter", "much_shorter", "grow_longer", "not_sure"] as const;
export const MAINTENANCE_LEVELS = ["very_low", "low", "moderate", "high"] as const;
export const STYLE_DIRECTIONS = ["professional", "natural", "classic", "modern", "relaxed", "bold"] as const;
export const COLOUR_PREFERENCES = ["keep_current", "slight_change", "new_colour", "no_preference"] as const;

export const ALTERATION_PRESETS = [
  "Keep more length",
  "Make the sides shorter",
  "Add more layers",
  "Reduce volume",
  "Keep it more natural",
  "Make it more professional",
  "Keep enough length for a bun",
  "Make the fringe shorter",
  "Make it easier to maintain",
] as const;

export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type AcceptedImageType = (typeof ACCEPTED_IMAGE_TYPES)[number];

export const ANALYTICS_EVENTS = [
  "landing_viewed",
  "upload_started",
  "upload_completed",
  "generation_1",
  "generation_2",
  "generation_3",
  "email_submitted",
  "email_verified",
  "free_allowance_completed",
  "paywall_viewed",
  "checkout_started",
  "subscription_completed",
  "hairstyle_selected",
  "alteration_requested",
  "download",
  "email_share",
  "qr_generated",
  "qr_viewed",
  "project_deleted",
  "subscription_cancelled",
] as const;
export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];

export function isAnalyticsEvent(v: unknown): v is AnalyticsEvent {
  return typeof v === "string" && (ANALYTICS_EVENTS as readonly string[]).includes(v);
}
