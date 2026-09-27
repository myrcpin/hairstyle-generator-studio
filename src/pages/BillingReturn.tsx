import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { callFn, errorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Alert, Spinner } from "../components/ui";

/** PayPal redirects here after approval. We confirm with PayPal server-side; activation also arrives by webhook. */
export default function BillingReturn() {
  const [params] = useSearchParams();
  const { refresh } = useAuth();
  const [state, setState] = useState<"checking" | "active" | "pending" | "error">("checking");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const subscriptionId = params.get("subscription_id") ?? undefined;
    (async () => {
      for (let i = 0; i < 10 && !cancelled; i++) {
        try {
          const r = await callFn<{ status: string }>("billing", { action: "confirm", subscriptionId });
          if (r.status === "active") { await refresh(); if (!cancelled) setState("active"); return; }
          if (["cancelled", "expired", "suspended"].includes(r.status)) { if (!cancelled) { setState("error"); setError("PayPal didn't complete the subscription. You haven't been charged."); } return; }
        } catch (e) {
          if (!cancelled) { setState("error"); setError(errorMessage(e)); }
          return;
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
      if (!cancelled) setState("pending");
    })();
    return () => { cancelled = true; };
  }, [params, refresh]);

  return (
    <div className="container-x max-w-xl py-16">
      {state === "checking" && <p role="status" className="flex items-center gap-3 text-[18px]"><Spinner /> Confirming your subscription with PayPal…</p>}
      {state === "active" && (
        <div className="space-y-4">
          <h1 className="text-[44px] leading-tight">Welcome to Plus.</h1>
          <p className="text-ink-2">Your subscription is active. Pick a look and build your full Hairstyle Card.</p>
          <div className="flex gap-2"><Link to="/account" className="btn-primary">Go to my styles</Link><Link to="/start" className="btn-secondary">New project</Link></div>
        </div>
      )}
      {state === "pending" && (
        <div className="space-y-4">
          <Alert tone="info">We're still waiting for PayPal to confirm your first payment. This normally takes a few seconds but can take longer. We'll activate Plus automatically as soon as it's confirmed — you can safely leave this page.</Alert>
          <Link to="/account" className="btn-secondary">Go to my account</Link>
        </div>
      )}
      {state === "error" && <div className="space-y-4"><Alert>{error}</Alert><Link to="/pricing" className="btn-secondary">Back to pricing</Link></div>}
    </div>
  );
}
