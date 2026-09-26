import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { callFn } from "./api";
import { isConfigured } from "./config";
import type { Allowance, Profile } from "./types";

interface AuthState {
  ready: boolean;
  session: Session | null;
  profile: Profile | null;
  allowance: Allowance | null;
  isAnonymous: boolean;
  isVerified: boolean;
  ensureSession: () => Promise<Session>;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [allowance, setAllowance] = useState<Allowance | null>(null);

  const load = useCallback(async (s: Session | null) => {
    if (!s) { setProfile(null); setAllowance(null); return; }
    const [{ data }, allow] = await Promise.all([
      supabase.from("users").select("id,email,email_verified,subscription_status,subscription_plan,current_period_start,current_period_end,is_admin,created_at").eq("id", s.user.id).maybeSingle(),
      callFn<Allowance>("studio", { action: "allowance" }).catch(() => null),
    ]);
    setProfile((data as Profile) ?? null);
    setAllowance(allow);
  }, []);

  useEffect(() => {
    if (!isConfigured) { setReady(true); return; }
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      await load(data.session).catch(() => undefined);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === "SIGNED_IN" || event === "USER_UPDATED" || event === "SIGNED_OUT") void load(s);
    });
    return () => sub.subscription.unsubscribe();
  }, [load]);

  const ensureSession = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) return data.session;
    const { data: anon, error } = await supabase.auth.signInAnonymously();
    if (error || !anon.session) throw new Error("Could not start a session. Please refresh and try again.");
    setSession(anon.session);
    return anon.session;
  }, []);

  const value = useMemo<AuthState>(() => {
    const u = session?.user;
    return {
      ready, session, profile, allowance,
      isAnonymous: !!u && ((u as { is_anonymous?: boolean }).is_anonymous === true) && !u.email_confirmed_at,
      isVerified: !!u?.email && !!u.email_confirmed_at,
      ensureSession,
      refresh: async () => { const { data } = await supabase.auth.getSession(); await load(data.session); },
      signOut: async () => { await supabase.auth.signOut(); setSession(null); },
    };
  }, [ready, session, profile, allowance, ensureSession, load]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}
