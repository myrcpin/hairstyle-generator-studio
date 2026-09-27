import { admin, type AuthedUser, getAllowance } from "../_shared/db.ts";
import { HttpError, json } from "../_shared/http.ts";
import { paypal } from "../_shared/paypal.ts";
import { deleteProjectData } from "./projects.ts";

export async function allowance(req: Request, user: AuthedUser) {
  return json(req, await getAllowance(user.id));
}

/** Right to erasure: cancels billing, deletes every stored image and the account. */
export async function deleteAccount(req: Request, user: AuthedUser, body: Record<string, unknown>) {
  if (body.confirm !== "DELETE") return json(req, { error: { code: "invalid_input", message: "Type DELETE to confirm." } }, 400);
  const db = admin();
  // A salon's only owner must cancel the salon plan (or add another owner) first, so the salon isn't left billing with no admin.
  const { data: owned } = await db.from("organization_members").select("org_id, organizations(subscription_status)").eq("user_id", user.id).eq("role", "owner");
  for (const m of owned ?? []) {
    const { count } = await db.from("organization_members").select("user_id", { count: "exact", head: true }).eq("org_id", m.org_id).eq("role", "owner");
    const status = (m.organizations as unknown as { subscription_status: string })?.subscription_status;
    if ((count ?? 0) <= 1 && ["active", "pending", "past_due"].includes(status)) {
      return json(req, { error: { code: "invalid_input", message: "You're the only owner of a salon with an active plan. Cancel the salon plan or add another owner first." } }, 409);
    }
  }
  const { data: profile } = await db.from("users").select("paypal_subscription_id,subscription_status").eq("id", user.id).single();
  if (profile?.paypal_subscription_id && ["active", "pending", "past_due", "suspended"].includes(profile.subscription_status)) {
    await paypal(`/v1/billing/subscriptions/${profile.paypal_subscription_id}/cancel`, {
      method: "POST", body: JSON.stringify({ reason: "Account deleted by user" }),
    }).catch(() => null);
  }
  const { data: projects } = await db.from("projects").select("id").eq("user_id", user.id);
  for (const p of projects ?? []) await deleteProjectData(user.id, p.id);
  await db.auth.admin.deleteUser(user.id);
  return json(req, { deleted: true });
}

/**
 * A visitor started anonymously, then verified an email that already had an account.
 * Moves the anonymous session's projects into the signed-in account, then removes the anonymous user.
 */
export async function claim(req: Request, user: AuthedUser, body: Record<string, unknown>) {
  if (!user.email || !user.emailVerified) throw new HttpError(403, "email_required");
  const db = admin();
  const { data } = await db.auth.getUser(String(body.anonToken ?? ""));
  const anon = data.user;
  if (!anon || anon.id === user.id || (anon as { is_anonymous?: boolean }).is_anonymous !== true) throw new HttpError(400, "invalid_input");
  for (const table of ["projects", "generations", "style_cards"] as const) {
    await db.from(table).update({ user_id: user.id }).eq("user_id", anon.id);
  }
  await db.auth.admin.deleteUser(anon.id);
  return json(req, { claimed: true });
}
