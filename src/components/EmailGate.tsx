import { useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { callFn } from "../lib/api";
import { trackClient } from "../lib/analytics";
import { Alert, Spinner } from "./ui";
import { isDisposableEmail, isValidEmail, normaliseEmail } from "../../supabase/functions/_shared/core/email.ts";
import { Link } from "react-router-dom";

/**
 * Verifies an email with a 6-digit code without leaving the page.
 * Anonymous visitors: links the email to their current (anonymous) account so their project is kept.
 * If the email already has an account: signs in to it and moves this session's projects across.
 */
export function EmailGate({ onVerified, title = "Where should we send your styles?" }: { onVerified: () => void; title?: string }) {
  const { refresh } = useAuth();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"email" | "code">("email");
  const [mode, setMode] = useState<"link" | "signin">("link");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [anonToken, setAnonToken] = useState<string | null>(null);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const addr = normaliseEmail(email);
    if (!isValidEmail(addr)) return setError("Please enter a valid email address.");
    if (isDisposableEmail(addr)) return setError("Please use a permanent email address — temporary inboxes aren't supported.");
    setBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { error: err } = await supabase.auth.updateUser({ email: addr });
      if (err) {
        // Email belongs to an existing account -> sign in with a code instead, then claim this session's projects.
        if (/already|registered|exists/i.test(err.message)) {
          setAnonToken(session?.access_token ?? null);
          const { error: e2 } = await supabase.auth.signInWithOtp({ email: addr, options: { shouldCreateUser: false } });
          if (e2) throw e2;
          setMode("signin");
        } else if (/rate|seconds/i.test(err.message)) {
          throw new Error("Please wait a minute before requesting another code.");
        } else throw err;
      } else setMode("link");
      trackClient("email_submitted");
      setStage("code");
    } catch (e2) {
      setError(e2 instanceof Error && e2.message.startsWith("Please") ? e2.message : "We couldn't send a code right now. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const token = code.replace(/\D/g, "");
    if (token.length !== 6) return setError("Enter the 6-digit code from the email.");
    setBusy(true);
    try {
      const addr = normaliseEmail(email);
      const { error: err } = await supabase.auth.verifyOtp({ email: addr, token, type: mode === "link" ? "email_change" : "email" });
      if (err) throw err;
      if (mode === "signin" && anonToken) {
        await callFn("studio", { action: "claim", anonToken }).catch(() => undefined);
      }
      trackClient("email_verified");
      await refresh();
      onVerified();
    } catch {
      setError("That code didn't work. Check the latest email, or request a new code.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-[30px] leading-tight">{title}</h2>
      {stage === "email" ? (
        <form onSubmit={sendCode} className="space-y-3" noValidate>
          <p className="text-ink-2">We'll email you a 6-digit code. Verifying your email keeps free styles fair for everyone and lets you come back to your looks.</p>
          <label htmlFor="gate-email" className="block text-[14px] font-medium">Email address</label>
          <input id="gate-email" className="input" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <p className="text-[13px] text-muted">By continuing you agree to the <Link className="underline" to="/terms">Terms</Link> and <Link className="underline" to="/privacy">Privacy Policy</Link>. No marketing emails unless you opt in.</p>
          {error && <Alert>{error}</Alert>}
          <button className="btn-primary w-full sm:w-auto" disabled={busy}>{busy ? <Spinner label="Sending code" /> : "Send my code"}</button>
        </form>
      ) : (
        <form onSubmit={verify} className="space-y-3" noValidate>
          <p className="text-ink-2">We sent a code to <strong>{email}</strong>. It can take a minute to arrive — check spam too.</p>
          <label htmlFor="gate-code" className="block text-[14px] font-medium">6-digit code</label>
          <input id="gate-code" className="input tracking-[0.4em]" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} />
          {error && <Alert>{error}</Alert>}
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" disabled={busy}>{busy ? <Spinner label="Verifying" /> : "Verify and continue"}</button>
            <button type="button" className="btn-ghost" onClick={() => { setStage("email"); setCode(""); }}>Use a different email</button>
          </div>
        </form>
      )}
    </div>
  );
}
