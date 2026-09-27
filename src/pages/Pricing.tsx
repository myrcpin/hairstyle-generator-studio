import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { usePublicConfig } from "../lib/publicConfig";
import { useAuth } from "../lib/auth";
import { callFn, errorMessage } from "../lib/api";
import { Alert, PageTitle, Spinner } from "../components/ui";
import { formatPrice, SUPPORTED_CURRENCIES } from "../../supabase/functions/_shared/core/pricing.ts";

export function CurrencySwitch() {
  const { currency, setCurrency } = usePublicConfig();
  return (
    <div className="flex items-center gap-2 text-[14px]" role="group" aria-label="Currency">
      <span className="text-muted">Prices in</span>
      {SUPPORTED_CURRENCIES.map((c) => (
        <button key={c} className="chip min-h-8 px-3" aria-pressed={c === currency} onClick={() => setCurrency(c)}>{c}</button>
      ))}
    </div>
  );
}

export function PricingTable() {
  const { plan, pack, config, currency } = usePublicConfig();
  const { session, isVerified, allowance } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const planPrice = plan.prices[currency]?.amount;
  const packPrice = pack.prices[currency]?.amount;

  async function checkout(kind: "pack" | "plus") {
    setError(null);
    if (!session || !isVerified) return navigate("/signin?next=/pricing");
    setBusy(kind);
    try {
      const r = kind === "pack"
        ? await callFn<{ approveUrl: string }>("billing", { action: "buy_pack", plan: pack.code, currency })
        : await callFn<{ approveUrl?: string; alreadyActive?: boolean }>("billing", { action: "create_subscription", currency });
      if ("alreadyActive" in r && r.alreadyActive) return navigate("/account");
      window.location.assign(r.approveUrl!);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="mb-4"><CurrencySwitch /></div>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="flex flex-col border border-line bg-paper p-6">
          <h3 className="text-[32px]">Free</h3>
          <p className="mt-1 text-[28px]">{formatPrice(0, currency)}</p>
          <ul className="mt-5 space-y-2 text-[15px] text-ink-2">
            <li>✓ {config.limits.free_generations} personalised hairstyle concepts</li>
            <li>✓ Standard preview</li>
            <li>• Email required</li>
          </ul>
          <Link to="/start" className="btn-secondary mt-6 w-full">Try 3 free styles</Link>
        </div>

        <div className="flex flex-col border border-ink bg-card p-6">
          <p className="eyebrow">Most popular · one-off</p>
          <h3 className="mt-1 text-[32px]">{pack.name}</h3>
          <p className="mt-1 text-[28px]">{packPrice ? formatPrice(packPrice, currency) : "—"}<span className="text-[16px] text-muted"> once</span></p>
          <ul className="mt-5 space-y-2 text-[15px] text-ink-2">
            <li>✓ {pack.generations} more personalised styles</li>
            <li>✓ {pack.alterations} alteration to fine-tune your favourite</li>
            <li>✓ {pack.card_builds} full Hairstyle Card with extra angles</li>
            <li>✓ High-resolution downloads, QR sharing, email</li>
            <li>✓ Valid for {pack.access_days ?? 60} days · no subscription</li>
          </ul>
          <button className="btn-primary mt-6 w-full" onClick={() => checkout("pack")} disabled={!!busy || !packPrice}>
            {busy === "pack" ? <Spinner label="Opening PayPal" /> : `Get the ${pack.name}`}
          </button>
          <p className="mt-3 text-[13px] text-muted">Paid once through PayPal. Nothing renews.</p>
        </div>

        <div className="flex flex-col border border-line bg-card p-6">
          <p className="eyebrow">Monthly</p>
          <h3 className="mt-1 text-[32px]">{plan.name}</h3>
          <p className="mt-1 text-[28px]">{planPrice ? formatPrice(planPrice, currency) : "—"}<span className="text-[16px] text-muted">/month</span></p>
          <ul className="mt-5 space-y-2 text-[15px] text-ink-2">
            <li>✓ {plan.generations} personalised generations each month</li>
            <li>✓ {plan.alterations} alterations</li>
            <li>✓ Full Hairstyle Card with extra angles</li>
            <li>✓ High-resolution downloads, email, QR sharing</li>
            <li>✓ Saved projects</li>
          </ul>
          {allowance?.subscribed ? (
            <Link to="/account" className="btn-secondary mt-6 w-full">You're on {plan.name} — manage</Link>
          ) : (
            <button className="btn-secondary mt-6 w-full" onClick={() => checkout("plus")} disabled={!!busy || !planPrice}>
              {busy === "plus" ? <Spinner label="Opening PayPal" /> : `Get ${plan.name}`}
            </button>
          )}
          <p className="mt-3 text-[13px] text-muted">Billed monthly by PayPal. Cancel any time.</p>
        </div>
      </div>
      {error && <div className="mt-4"><Alert>{error}</Alert></div>}
      <p className="mt-6 text-[15px] text-ink-2">Run a salon or barbershop? <Link to="/business" className="underline">See {`the business plans`}</Link> — offer Hairstyle Cards to your clients.</p>
    </div>
  );
}

export default function Pricing() {
  const [params] = useSearchParams();
  return (
    <div className="container-x py-12">
      <PageTitle eyebrow="Pricing" title="Simple pricing.">Try three styles free. Grab a one-off Starter Pack when you've found a direction, or go monthly with Plus.</PageTitle>
      {params.get("cancelled") && <div className="mb-6"><Alert tone="info">Checkout was cancelled — you haven't been charged.</Alert></div>}
      <PricingTable />
    </div>
  );
}
