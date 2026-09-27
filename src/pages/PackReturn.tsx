import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { callFn, errorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Alert, Spinner } from "../components/ui";

/** PayPal sends the buyer here with ?token=<orderId>. We capture and verify server-side. */
export default function PackReturn() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [state, setState] = useState<"working" | "done" | "error">("working");
  const [error, setError] = useState<string | null>(null);
  const once = useRef(false);

  useEffect(() => {
    if (once.current) return;
    once.current = true;
    const orderId = params.get("token");
    if (!orderId) { setState("error"); setError("We couldn't find your PayPal order. You haven't been charged."); return; }
    callFn("billing", { action: "capture_pack", orderId })
      .then(async () => { await refresh(); setState("done"); })
      .catch((e) => { setState("error"); setError(errorMessage(e)); });
  }, [params, refresh]);

  return (
    <div className="container-x max-w-xl py-16">
      {state === "working" && <p role="status" className="flex items-center gap-3 text-[18px]"><Spinner /> Confirming your payment with PayPal…</p>}
      {state === "done" && (
        <div className="space-y-5">
          <h1 className="text-[44px] leading-tight">Your Starter Pack is ready.</h1>
          <p className="text-ink-2">New styles, an alteration and a full Hairstyle Card have been added to your account.</p>
          <div className="border border-ink bg-card p-5">
            <h2 className="text-[26px]">Got 20 seconds?</h2>
            <p className="mt-1 text-ink-2">Answer 5 quick questions about how you get your hair cut so we can tailor your styles and cards.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button className="btn-primary" onClick={() => navigate("/survey")}>Answer 5 questions</button>
              <Link to="/account" className="btn-ghost">Skip for now</Link>
            </div>
          </div>
        </div>
      )}
      {state === "error" && <div className="space-y-4"><Alert>{error}</Alert><Link to="/pricing" className="btn-secondary">Back to pricing</Link></div>}
    </div>
  );
}
