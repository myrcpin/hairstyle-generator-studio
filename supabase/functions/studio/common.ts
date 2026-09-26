import { admin, type AuthedUser } from "../_shared/db.ts";
import { HttpError, isUuid } from "../_shared/http.ts";
import { getSettings } from "../_shared/settings.ts";
import { isDisposableEmail } from "../_shared/core/email.ts";

export async function ownedProject(user: AuthedUser, projectId: unknown) {
  if (!isUuid(projectId)) throw new HttpError(400, "invalid_input");
  const { data } = await admin().from("projects").select("*").eq("id", projectId).maybeSingle();
  if (!data || data.user_id !== user.id) throw new HttpError(404, "not_found");
  if (data.status === "expired" || new Date(data.expires_at) < new Date()) throw new HttpError(410, "expired");
  return data;
}

export async function ownedGeneration(user: AuthedUser, generationId: unknown) {
  if (!isUuid(generationId)) throw new HttpError(400, "invalid_input");
  const { data } = await admin().from("generations").select("*").eq("id", generationId).maybeSingle();
  if (!data || data.user_id !== user.id) throw new HttpError(404, "not_found");
  return data;
}

/** Generation requires a verified, non-disposable email (abuse control). */
export async function requireVerifiedEmail(user: AuthedUser) {
  const s = await getSettings();
  if (!s.features.require_email_before_generation) return;
  if (!user.email || !user.emailVerified) throw new HttpError(403, "email_required");
  if (s.features.block_disposable_email && isDisposableEmail(user.email)) throw new HttpError(403, "disposable_email");
}

export function idemKey(v: unknown): string {
  if (typeof v !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(v)) throw new HttpError(400, "invalid_input");
  return v;
}

export function isInsufficient(err: { message?: string } | null): boolean {
  return !!err?.message?.includes("insufficient_credits");
}
