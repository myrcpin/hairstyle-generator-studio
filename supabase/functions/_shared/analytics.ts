import { admin } from "./db.ts";
import type { AnalyticsEvent } from "./core/constants.ts";

/** Server-side analytics: event name + ids + small non-personal props only. */
export async function track(event: AnalyticsEvent, userId: string | null, projectId?: string | null, props: Record<string, string | number | boolean> = {}) {
  const { error } = await admin().from("analytics_events").insert({ event, user_id: userId, project_id: projectId ?? null, props });
  if (error) console.error("analytics insert failed", error.message);
}
