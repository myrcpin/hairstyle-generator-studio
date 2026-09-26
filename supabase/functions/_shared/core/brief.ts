// Structured style brief produced by the text model, plus strict output validation.
import { DIRECTIONS, type Direction } from "./constants.ts";

export type PhotoIssue = "none" | "no_person" | "multiple_people" | "face_not_visible" | "hair_not_visible" | "unsuitable_image";
export type Feasibility = "achievable_now" | "needs_growth" | "concept_only";

export interface PhotoCheck {
  person_count: number;
  face_visible: boolean;
  hair_visible: boolean;
  suitable: boolean;
  issue: PhotoIssue;
}

export interface StyleBrief {
  current_length: string;
  texture: string;
  density: string;
  current_style: string;
  requested_change: string;
  length_constraints: string[];
  styling_constraints: string[];
  maintenance_preference: string;
  formality: "professional" | "casual" | "mixed" | "unspecified";
  colour_preference: string;
  reference_characteristics: string | null;
  keep: string[];
  change: string[];
  feasibility_warnings: string[];
}

export interface Recommendation {
  direction: Direction;
  name: string;
  description: string;
  why_it_fits: string;
  intended_length: string;
  maintenance: string;
  cutting_characteristics: string[];
  colour_note: string | null;
  feasibility: Feasibility;
  feasibility_note: string | null;
  tied_back_relevant: boolean;
}

export interface Analysis {
  photo_check: PhotoCheck;
  brief: StyleBrief;
  recommendations: Recommendation[];
}

const str = { type: "string" } as const;
const strArr = { type: "array", items: { type: "string" } } as const;
const nullableStr = { type: ["string", "null"] } as const;

const recommendationSchema = (directions: readonly string[]) => ({
  type: "object",
  additionalProperties: false,
  required: ["direction", "name", "description", "why_it_fits", "intended_length", "maintenance",
    "cutting_characteristics", "colour_note", "feasibility", "feasibility_note", "tied_back_relevant"],
  properties: {
    direction: { type: "string", enum: [...directions] },
    name: str,
    description: str,
    why_it_fits: str,
    intended_length: str,
    maintenance: str,
    cutting_characteristics: strArr,
    colour_note: nullableStr,
    feasibility: { type: "string", enum: ["achievable_now", "needs_growth", "concept_only"] },
    feasibility_note: nullableStr,
    tied_back_relevant: { type: "boolean" },
  },
});

export const ANALYSIS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["photo_check", "brief", "recommendations"],
  properties: {
    photo_check: {
      type: "object",
      additionalProperties: false,
      required: ["person_count", "face_visible", "hair_visible", "suitable", "issue"],
      properties: {
        person_count: { type: "integer" },
        face_visible: { type: "boolean" },
        hair_visible: { type: "boolean" },
        suitable: { type: "boolean" },
        issue: { type: "string", enum: ["none", "no_person", "multiple_people", "face_not_visible", "hair_not_visible", "unsuitable_image"] },
      },
    },
    brief: {
      type: "object",
      additionalProperties: false,
      required: ["current_length", "texture", "density", "current_style", "requested_change", "length_constraints",
        "styling_constraints", "maintenance_preference", "formality", "colour_preference", "reference_characteristics",
        "keep", "change", "feasibility_warnings"],
      properties: {
        current_length: str, texture: str, density: str, current_style: str, requested_change: str,
        length_constraints: strArr, styling_constraints: strArr, maintenance_preference: str,
        formality: { type: "string", enum: ["professional", "casual", "mixed", "unspecified"] },
        colour_preference: str, reference_characteristics: nullableStr,
        keep: strArr, change: strArr, feasibility_warnings: strArr,
      },
    },
    recommendations: { type: "array", items: recommendationSchema(DIRECTIONS) },
  },
} as const;

export const EXTRA_RECOMMENDATION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["recommendation"],
  properties: { recommendation: recommendationSchema(["extra"]) },
} as const;

// ---------------------------------------------------------------------------
// Output validation: the model's JSON is untrusted. Clamp, coerce, reject.
// ---------------------------------------------------------------------------
export class InvalidModelOutput extends Error {}

function s(v: unknown, max = 400, fallback = ""): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : fallback;
}
function ns(v: unknown, max = 400): string | null {
  const x = s(v, max);
  return x ? x : null;
}
function arr(v: unknown, maxItems = 8, maxLen = 200): string[] {
  return Array.isArray(v) ? v.map((x) => s(x, maxLen)).filter(Boolean).slice(0, maxItems) : [];
}
function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

export function sanitizeRecommendation(raw: unknown, direction?: Direction): Recommendation {
  const r = (raw ?? {}) as Record<string, unknown>;
  const name = s(r.name, 60);
  const description = s(r.description, 240);
  if (!name || !description) throw new InvalidModelOutput("recommendation missing name/description");
  return {
    direction: direction ?? oneOf(r.direction, [...DIRECTIONS, "extra"] as Direction[], "extra"),
    name,
    description,
    why_it_fits: s(r.why_it_fits, 300),
    intended_length: s(r.intended_length, 160),
    maintenance: s(r.maintenance, 160),
    cutting_characteristics: arr(r.cutting_characteristics, 6, 160),
    colour_note: ns(r.colour_note, 200),
    feasibility: oneOf(r.feasibility, ["achievable_now", "needs_growth", "concept_only"] as const, "achievable_now"),
    feasibility_note: ns(r.feasibility_note, 240),
    tied_back_relevant: r.tied_back_relevant === true,
  };
}

export function sanitizeAnalysis(raw: unknown): Analysis {
  const r = (raw ?? {}) as Record<string, unknown>;
  const pc = (r.photo_check ?? {}) as Record<string, unknown>;
  const b = (r.brief ?? {}) as Record<string, unknown>;
  const personCount = Number.isFinite(pc.person_count) ? Math.max(0, Math.min(20, Math.trunc(pc.person_count as number))) : 0;
  let issue = oneOf(pc.issue, ["none", "no_person", "multiple_people", "face_not_visible", "hair_not_visible", "unsuitable_image"] as const, "unsuitable_image");
  // Enforce consistency regardless of what the model claims.
  if (personCount === 0) issue = "no_person";
  else if (personCount > 1) issue = "multiple_people";
  else if (pc.face_visible === false && issue === "none") issue = "face_not_visible";
  else if (pc.hair_visible === false && issue === "none") issue = "hair_not_visible";
  const photo_check: PhotoCheck = {
    person_count: personCount,
    face_visible: pc.face_visible === true,
    hair_visible: pc.hair_visible === true,
    suitable: issue === "none" && pc.suitable === true,
    issue: issue === "none" && pc.suitable !== true ? "unsuitable_image" : issue,
  };

  const brief: StyleBrief = {
    current_length: s(b.current_length, 120),
    texture: s(b.texture, 120),
    density: s(b.density, 120),
    current_style: s(b.current_style, 200),
    requested_change: s(b.requested_change, 300),
    length_constraints: arr(b.length_constraints),
    styling_constraints: arr(b.styling_constraints),
    maintenance_preference: s(b.maintenance_preference, 120),
    formality: oneOf(b.formality, ["professional", "casual", "mixed", "unspecified"] as const, "unspecified"),
    colour_preference: s(b.colour_preference, 120),
    reference_characteristics: ns(b.reference_characteristics, 400),
    keep: arr(b.keep),
    change: arr(b.change),
    feasibility_warnings: arr(b.feasibility_warnings, 5, 240),
  };

  if (!photo_check.suitable) return { photo_check, brief, recommendations: [] };

  const recsRaw = Array.isArray(r.recommendations) ? r.recommendations : [];
  const recommendations: Recommendation[] = [];
  for (const dir of DIRECTIONS) {
    const found = recsRaw.find((x) => (x as Record<string, unknown>)?.direction === dir);
    if (!found) throw new InvalidModelOutput(`missing ${dir} recommendation`);
    recommendations.push(sanitizeRecommendation(found, dir));
  }
  const names = new Set(recommendations.map((x) => x.name.toLowerCase()));
  if (names.size !== recommendations.length) throw new InvalidModelOutput("recommendations are not distinct");
  return { photo_check, brief, recommendations };
}
