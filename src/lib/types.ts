import type { Recommendation, StyleBrief } from "../../supabase/functions/_shared/core/brief.ts";
import type { CardData } from "../../supabase/functions/_shared/core/card.ts";
import type { CardView } from "../../supabase/functions/_shared/core/constants.ts";

export type { Recommendation, StyleBrief, CardData, CardView };

export interface Profile {
  id: string;
  email: string | null;
  email_verified: boolean;
  subscription_status: "none" | "pending" | "active" | "past_due" | "suspended" | "cancelled" | "expired";
  subscription_plan: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  is_admin: boolean;
  created_at: string;
}

export interface Allowance {
  paid: boolean;
  subscription_status: string;
  period_end: string | null;
  free: { limit: number; used: number; remaining: number };
  subscription: Record<"generations" | "alterations" | "card_builds", { limit: number; used: number; remaining: number }>;
  remaining: Record<"generations" | "alterations" | "card_builds", number>;
}

export interface Project {
  id: string;
  status: "draft" | "analysing" | "ready" | "rejected" | "generating" | "complete" | "expired";
  brief: StyleBrief | null;
  recommendations: Recommendation[] | null;
  rejection_reason: string | null;
  saved: boolean;
  created_at: string;
  expires_at: string;
}

export interface Generation {
  id: string;
  project_id: string;
  parent_generation_id: string | null;
  generation_type: "concept" | "alteration" | "card_view";
  direction: string | null;
  view: CardView;
  recommendation: Recommendation | null;
  instruction: string | null;
  status: "queued" | "processing" | "succeeded" | "failed" | "cancelled";
  error_message: string | null;
  concept_only: boolean;
  created_at: string;
}

export interface CardPayload {
  id?: string;
  projectId?: string;
  tier?: "preview" | "full";
  status?: "building" | "ready" | "failed";
  data: CardData & { disclaimer: string };
  images: Partial<Record<CardView, { url: string | null; download: string | null } | null>>;
  original: string | null;
  qr?: string | null;
  publicUrl?: string | null;
  revoked?: boolean;
  expiresAt: string;
}
