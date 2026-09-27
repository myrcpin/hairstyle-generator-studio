import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { HttpError, requireEnv } from "./http.ts";

let _admin: SupabaseClient | null = null;

/** Service-role client. Bypasses RLS — only used server-side after authorisation checks. */
export function admin(): SupabaseClient {
  if (!_admin) {
    _admin = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _admin;
}

export interface AuthedUser {
  id: string;
  email: string | null;
  emailVerified: boolean;
  isAnonymous: boolean;
}

export async function getUser(req: Request, { optional = false } = {}): Promise<AuthedUser | null> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) {
    if (optional) return null;
    throw new HttpError(401, "unauthorized");
  }
  const { data, error } = await admin().auth.getUser(token);
  if (error || !data.user) {
    if (optional) return null;
    throw new HttpError(401, "unauthorized");
  }
  const u = data.user;
  return {
    id: u.id,
    email: u.email ?? null,
    emailVerified: !!u.email && !!u.email_confirmed_at,
    isAnonymous: (u as { is_anonymous?: boolean }).is_anonymous === true,
  };
}

export async function requireUser(req: Request): Promise<AuthedUser> {
  return (await getUser(req))!;
}

export async function getAllowance(userId: string): Promise<Allowance> {
  const { data, error } = await admin().rpc("get_allowance", { p_user: userId });
  if (error || !data) throw new HttpError(500, "server_error");
  return data as Allowance;
}

export interface Allowance {
  paid: boolean;
  subscribed: boolean;
  access_until: string | null;
  subscription_status: string;
  plan: string | null;
  period_start: string | null;
  period_end: string | null;
  email_verified: boolean;
  free: { limit: number; used: number; remaining: number };
  subscription: Record<"generations" | "alterations" | "card_builds", { limit: number; used: number; remaining: number }>;
  grants: Record<"generations" | "alterations" | "card_builds", number>;
  remaining: Record<"generations" | "alterations" | "card_builds", number>;
}
