// Hairstyle Card content. Text comes from a model, layout is deterministic HTML/CSS.
import type { Recommendation, StyleBrief } from "./brief.ts";
import type { CardView } from "./constants.ts";

export interface CardContent {
  what_to_ask_for: string;
  keep: string[];
  change: string[];
  length_guide: { area: string; guidance: string }[];
  styling: string[];
  maintenance: { summary: string; trim_interval: string; daily_effort: string };
}

export interface CardData extends CardContent {
  style_name: string;
  description: string;
  feasibility: Recommendation["feasibility"];
  feasibility_note: string | null;
  views: { view: CardView; generation_id: string | null; status: "pending" | "ready" | "unavailable" }[];
  generated_at: string;
  prompt_version: string;
  /** Present on salon consultations: shown as "Prepared by <salon>" with a booking link. */
  brand?: { org_id: string; name: string; booking_url: string | null } | null;
}

export const CARD_CONTENT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["what_to_ask_for", "keep", "change", "length_guide", "styling", "maintenance"],
  properties: {
    what_to_ask_for: { type: "string" },
    keep: { type: "array", items: { type: "string" } },
    change: { type: "array", items: { type: "string" } },
    length_guide: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["area", "guidance"],
        properties: { area: { type: "string" }, guidance: { type: "string" } },
      },
    },
    styling: { type: "array", items: { type: "string" } },
    maintenance: {
      type: "object", additionalProperties: false, required: ["summary", "trim_interval", "daily_effort"],
      properties: { summary: { type: "string" }, trim_interval: { type: "string" }, daily_effort: { type: "string" } },
    },
  },
} as const;

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const list = (v: unknown, n = 6, max = 180) => (Array.isArray(v) ? v.map((x) => clean(x, max)).filter(Boolean).slice(0, n) : []);

/** Removes invented precise measurements (cm/mm/inches/clipper grades) unless the user supplied them. */
export function stripMeasurements(text: string, userText: string | null): string {
  const re = /\b\d+(?:[.,]\d+)?\s?(?:cm|mm|centimet(?:re|er)s?|millimet(?:re|er)s?|inch(?:es)?|in\b|")|\b(?:grade|number|no\.?|#)\s?\d(?:\.\d)?\b/gi;
  return text.replace(re, (m) => (userText && userText.toLowerCase().includes(m.toLowerCase().trim()) ? m : "")).replace(/\s{2,}/g, " ").replace(/\s+([,.;])/g, "$1").trim();
}

export function sanitizeCardContent(raw: unknown, userText: string | null, fallback: { brief: StyleBrief; rec: Recommendation }): CardContent {
  const r = (raw ?? {}) as Record<string, unknown>;
  const m = (r.maintenance ?? {}) as Record<string, unknown>;
  const sm = (t: string) => stripMeasurements(t, userText);
  const lg = Array.isArray(r.length_guide) ? r.length_guide : [];
  const content: CardContent = {
    what_to_ask_for: sm(clean(r.what_to_ask_for, 700)) || fallback.rec.description,
    keep: list(r.keep).map(sm),
    change: list(r.change).map(sm),
    length_guide: lg.slice(0, 6).map((x) => {
      const o = (x ?? {}) as Record<string, unknown>;
      return { area: clean(o.area, 40), guidance: sm(clean(o.guidance, 200)) };
    }).filter((x) => x.area && x.guidance),
    styling: list(r.styling).map(sm),
    maintenance: {
      summary: sm(clean(m.summary, 240)) || fallback.rec.maintenance,
      trim_interval: clean(m.trim_interval, 80),
      daily_effort: clean(m.daily_effort, 80),
    },
  };
  if (!content.keep.length) content.keep = fallback.brief.keep.slice(0, 6);
  if (!content.change.length) content.change = fallback.brief.change.slice(0, 6);
  return content;
}

/** Deterministic fallback when the text model is unavailable — the card still works. */
export function fallbackCardContent(brief: StyleBrief, rec: Recommendation): CardContent {
  return {
    what_to_ask_for: `${rec.description}${rec.intended_length ? ` Overall length: ${rec.intended_length}.` : ""}${rec.cutting_characteristics.length ? ` ${rec.cutting_characteristics.join(". ")}.` : ""}`,
    keep: brief.keep.slice(0, 6),
    change: brief.change.slice(0, 6),
    length_guide: rec.intended_length ? [{ area: "Overall", guidance: rec.intended_length }] : [],
    styling: [],
    maintenance: { summary: rec.maintenance, trim_interval: "", daily_effort: "" },
  };
}

export const CARD_DISCLAIMER =
  "This card is a visual communication aid created with AI image generation. Real results depend on your hair, your stylist and how you style it — it is not a guarantee of the final haircut.";
