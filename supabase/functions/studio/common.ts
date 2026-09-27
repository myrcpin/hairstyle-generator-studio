import { admin, type AuthedUser, getAllowance } from "../_shared/db.ts";
import { HttpError, isUuid } from "../_shared/http.ts";
import { getSettings } from "../_shared/settings.ts";
import { isDisposableEmail } from "../_shared/core/email.ts";

export interface ProjectRow {
  id: string; user_id: string; org_id: string | null; status: string; expires_at: string; created_at: string; updated_at: string;
  brief: unknown; recommendations: unknown; client_label: string | null;
  [k: string]: unknown;
}

export async function isOrgMember(orgId: string, userId: string): Promise<boolean> {
  const { data } = await admin().from("organization_members").select("user_id").eq("org_id", orgId).eq("user_id", userId).maybeSingle();
  return !!data;
}

/** A project is accessible to its creator, or to any staff member of the salon it belongs to. */
export async function canAccessProject(user: AuthedUser, project: { user_id: string; org_id: string | null }): Promise<boolean> {
  if (project.user_id === user.id) return true;
  return !!project.org_id && await isOrgMember(project.org_id, user.id);
}

export async function ownedProject(user: AuthedUser, projectId: unknown): Promise<ProjectRow> {
  if (!isUuid(projectId)) throw new HttpError(400, "invalid_input");
  const { data } = await admin().from("projects").select("*").eq("id", projectId).maybeSingle();
  if (!data || !(await canAccessProject(user, data))) throw new HttpError(404, "not_found");
  if (data.status === "expired" || new Date(data.expires_at) < new Date()) throw new HttpError(410, "expired");
  return data as ProjectRow;
}

export async function ownedGeneration(user: AuthedUser, generationId: unknown) {
  if (!isUuid(generationId)) throw new HttpError(400, "invalid_input");
  const { data } = await admin().from("generations").select("*").eq("id", generationId).maybeSingle();
  if (!data) throw new HttpError(404, "not_found");
  if (data.user_id !== user.id) {
    const { data: p } = await admin().from("projects").select("user_id,org_id").eq("id", data.project_id).maybeSingle();
    if (!p || !(await canAccessProject(user, p))) throw new HttpError(404, "not_found");
  }
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

export type CreditType = "generation" | "alteration" | "card_build";

/** Personal projects bill the person; salon sessions bill the salon. */
export async function reserveFor(user: AuthedUser, project: { id: string; org_id: string | null }, type: CreditType, key: string):
  Promise<{ usageId: string } | "insufficient"> {
  const db = admin();
  const { data, error } = project.org_id
    ? await db.rpc("reserve_org_usage", { p_org: project.org_id, p_user: user.id, p_project: project.id, p_type: type, p_key: key })
    : await db.rpc("reserve_usage", { p_user: user.id, p_project: project.id, p_type: type, p_key: key });
  if (error) {
    if (isInsufficient(error)) return "insufficient";
    if (error.message?.includes("forbidden")) throw new HttpError(403, "org_required");
    throw new HttpError(500, "server_error");
  }
  return { usageId: data as string };
}

export interface Access { paid: boolean; org: boolean; remaining: { generations: number; alterations: number; card_builds: number } }

/** "Plus-level" access for this project: personal plan/pack, or an active salon plan. */
export async function accessFor(user: AuthedUser, project: { org_id: string | null }): Promise<Access> {
  if (project.org_id) {
    const { data } = await admin().rpc("get_org_allowance", { p_org: project.org_id });
    const a = data as { active: boolean; generations: { remaining: number }; alterations: { remaining: number }; card_builds: { remaining: number } } | null;
    return {
      paid: !!a?.active, org: true,
      remaining: { generations: a?.generations.remaining ?? 0, alterations: a?.alterations.remaining ?? 0, card_builds: a?.card_builds.remaining ?? 0 },
    };
  }
  const a = await getAllowance(user.id);
  return { paid: a.paid, org: false, remaining: a.remaining };
}

/** Error to show when credits run out, by context. */
export function outOfCredits(access: Access): HttpError {
  if (access.org) return new HttpError(402, access.paid ? "insufficient_credits" : "org_inactive");
  return new HttpError(402, access.paid ? "insufficient_credits" : "paid_feature");
}
