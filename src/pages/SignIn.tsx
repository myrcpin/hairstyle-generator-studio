import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { Alert, PageTitle, Spinner } from "../components/ui";
import { EmailGate } from "../components/EmailGate";
import { isValidEmail, normaliseEmail } from "../../supabase/functions/_shared/core/email.ts";

export default function SignIn() {
  const [params] = useSearchParams();
  const next = params.get("next")?.startsWith("/") ? params.get("next")! : "/account";
  const navigate = useNavigate();
  const { session, isAnonymous, refresh } = useAuth();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // An anonymous visitor mid-flow verifies (and keeps) their current session instead.
  if (session && isAnonymous) {
    return (
      <div className="container-x max-w-lg py-12">
        <EmailGate title="Verify your email" onVerified={() => navigate(next)} />
      </div>
    );
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const addr = normaliseEmail(email);
    if (!isValidEmail(addr)) return setError("Please enter a valid email address.");
    setBusy(true);
    const { error: err } = await supabase.auth.signInWithOtp({ email: addr, options: { shouldCreateUser: true } });
    setBusy(false);
    if (err) return setError(/rate|seconds/i.test(err.message) ? "Please wait a minute before requesting another code." : "We couldn't send a code right now. Please try again.");
    setSent(true);
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error: err } = await supabase.auth.verifyOtp({ email: normaliseEmail(email), token: code.replace(/\D/g, ""), type: "email" });
    setBusy(false);
    if (err) return setError("That code didn't work. Check the latest email, or request a new code.");
    await refresh();
    navigate(next);
  }

  return (
    <div className="container-x max-w-lg py-12">
      <PageTitle eyebrow="Welcome back" title="Sign in">We'll email you a 6-digit code. No password needed.</PageTitle>
      {!sent ? (
        <form onSubmit={send} className="space-y-3" noValidate>
          <label htmlFor="si-email" className="block text-[14px] font-medium">Email address</label>
          <input id="si-email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          {error && <Alert>{error}</Alert>}
          <button className="btn-primary w-full" disabled={busy}>{busy ? <Spinner /> : "Email me a code"}</button>
        </form>
      ) : (
        <form onSubmit={verify} className="space-y-3" noValidate>
          <p className="text-ink-2">Code sent to <strong>{email}</strong>.</p>
          <label htmlFor="si-code" className="block text-[14px] font-medium">6-digit code</label>
          <input id="si-code" className="input tracking-[0.4em]" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} />
          {error && <Alert>{error}</Alert>}
          <button className="btn-primary w-full" disabled={busy}>{busy ? <Spinner /> : "Sign in"}</button>
        </form>
      )}
    </div>
  );
}
