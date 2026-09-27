import { callFn } from "./api";
import type { AnalyticsEvent } from "../../supabase/functions/_shared/core/constants.ts";

const CONSENT_KEY = "cc_analytics_consent";
const ANON_KEY = "cc_anon";

export function analyticsConsent(): "granted" | "denied" | null {
  try { return (localStorage.getItem(CONSENT_KEY) as "granted" | "denied" | null) ?? null; } catch { return null; }
}

export function setAnalyticsConsent(v: "granted" | "denied") {
  try {
    localStorage.setItem(CONSENT_KEY, v);
    if (v === "denied") localStorage.removeItem(ANON_KEY);
  } catch { /* storage unavailable */ }
}

function anonId(): string | undefined {
  if (analyticsConsent() !== "granted") return undefined; // no identifier without consent
  try {
    let v = localStorage.getItem(ANON_KEY);
    if (!v) { v = crypto.randomUUID().replace(/-/g, ""); localStorage.setItem(ANON_KEY, v); }
    return v;
  } catch { return undefined; }
}

/** Fire-and-forget. Only whitelisted, non-personal events; server tracks credit/payment events itself. */
export function trackClient(event: AnalyticsEvent, props: Record<string, string | number | boolean> = {}, projectId?: string) {
  void callFn("track", { event, anonId: anonId(), props, projectId }).catch(() => undefined);
}
