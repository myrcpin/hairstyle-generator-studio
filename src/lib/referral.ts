// Remembers a friend's invite code from ?ref=CODE until the visitor verifies their email.
import { callFn } from "./api";

const KEY = "cc_ref";

export function captureReferralFromUrl() {
  try {
    const code = new URLSearchParams(window.location.search).get("ref");
    if (code && /^[A-Za-z0-9]{6,12}$/.test(code)) localStorage.setItem(KEY, code.toUpperCase());
  } catch { /* storage unavailable */ }
}

export function pendingReferral(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

/** Called once the user has a verified email. The server decides eligibility. */
export async function attachPendingReferral() {
  const code = pendingReferral();
  if (!code) return;
  try {
    await callFn("studio", { action: "attach_referral", code });
  } catch { /* not eligible or invalid: nothing to do */ }
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
