import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { usePublicConfig } from "../lib/publicConfig";
import { useAuth } from "../lib/auth";
import { callFn, errorMessage } from "../lib/api";
import { Alert, PageTitle, Spinner } from "../components/ui";
import { formatPrice, SUPPORTED_CURRENCIES } from "../../supabase/functions/_shared/core/pricing.ts";

export function PricingTable() {
  const { plan, config, currency, setCurrency } = usePublicConfig();
  const { session, isVerified, allowance } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const price = plan.prices[currency]?.amount;

  async function subscribe() {
    setError(null);
    if (!session || !isVerified) return navigate("/signin?next=/pricing");
    setBusy(true);
    try {
      const r = await callFn<{ approveUrl?: string; alreadyActive?: boolean }>("billing", { action: "create_subscription", currency });
      if (r.alreadyActive) return navigate("/account");
      window.location.assign(r.approveUrl!);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center gap-2 text-[14px]" role="group" aria-label="Currency">
        <span className="text-muted">Prices in</span>
        {SUPPORTED_CURRENCIES.map((c) => (
          <button key={c} className="chip min-h-8 px-3" aria-pressed={c === currency} onClick={() => setCurrency(c)}>{c}</button>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="border border-line bg-paper p-6">
          <h3 className="text-[32px]">Free</h3>
          <p className="mt-1 text-[28px]">{formatPrice(0, currency)}</p>
          <ul className="mt-5 space-y-2 text-[15px] text-ink-2">
            <li>✓ {config.limits.free_generations} personalised hairstyle concepts</li>
            <li>✓ Standard preview</li>
            <li>• Email required</li>
          </ul>
          <Link to="/start" className="btn-secondary mt-6 w-full">Try 3 free styles</Link>
        </div>
        <div className="border border-ink bg-card p-6">
          <h3 className="text-[32px]">{plan.name}</h3>
          <p className="mt-1 text-[28px]">{price ? formatPrice(price, currency) : "—"}<span className="text-[16px] text-muted">/month</span></p>
          <ul className="mt-5 space-y-2 text-[15px] text-ink-2">
            <li>✓ {plan.generations} personalised generations each month</li>
            <li>✓ {plan.alterations} alterations</li>
            <li>✓ High-resolution downloads</li>
            <li>✓ Full Hairstyle Card with extra angles</li>
            <li>✓ Email delivery</li>
            <li>✓ QR sharing</li>
            <li>✓ Saved projects</li>
          </ul>
          {allowance?.paid ? (
            <Link to="/account" className="btn-primary mt-6 w-full">You're on Plus — manage</Link>
          ) : (
            <button className="btn-primary mt-6 w-full" onClick={subscribe} disabled={busy || !price}>
              {busy ? <Spinner label="Opening PayPal" /> : `Get ${plan.name}`}
            </button>
          )}
          <p className="mt-3 text-[13px] text-muted">Billed monthly by PayPal. Cancel any time; access continues to the end of the paid period.</p>
          {error && <div className="mt-3"><Alert>{error}</Alert></div>}
        </div>
      </div>
    </div>
  );
}

export default function Pricing() {
  const [params] = useSearchParams();
  return (
    <div className="container-x py-12">
      <PageTitle eyebrow="Pricing" title="Simple pricing." >Try three styles free. Upgrade for more looks, fine-tuning and the full Hairstyle Card.</PageTitle>
      {params.get("cancelled") && <div className="mb-6"><Alert tone="info">Checkout was cancelled — you haven't been charged.</Alert></div>}
      <PricingTable />
    </div>
  );
}
