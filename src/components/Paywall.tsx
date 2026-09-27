import { useEffect } from "react";
import { Link } from "react-router-dom";
import { trackClient } from "../lib/analytics";
import { usePublicConfig } from "../lib/publicConfig";
import { formatPrice } from "../../supabase/functions/_shared/core/pricing.ts";

export function Paywall({ reason, compact = false }: { reason: string; compact?: boolean }) {
  const { plan, pack, currency } = usePublicConfig();
  useEffect(() => { trackClient("paywall_viewed", { reason: reason.slice(0, 40) }); }, [reason]);
  const packPrice = pack.prices[currency]?.amount;
  const planPrice = plan.prices[currency]?.amount;
  return (
    <div className={`border border-ink bg-card ${compact ? "p-5" : "p-6 sm:p-8"}`}>
      <p className="eyebrow">{pack.name}{packPrice ? ` · ${formatPrice(packPrice, currency)} once` : ""}</p>
      <h3 className="mt-2 text-[30px] leading-tight">{reason}</h3>
      <ul className="mt-4 grid gap-1.5 text-[15px] text-ink-2 sm:grid-cols-2">
        <li>✓ {pack.generations} more personalised styles</li>
        <li>✓ {pack.alterations} alteration to fine-tune a look</li>
        <li>✓ Full Hairstyle Card with extra angles</li>
        <li>✓ High-resolution downloads</li>
        <li>✓ QR sharing and email delivery</li>
        <li>✓ No subscription</li>
      </ul>
      <div className="mt-6 flex flex-wrap items-center gap-4">
        <Link to="/pricing" className="btn-primary">Get the {pack.name}{packPrice ? ` — ${formatPrice(packPrice, currency)}` : ""}</Link>
        <Link to="/pricing" className="btn-ghost">or {plan.name}{planPrice ? ` ${formatPrice(planPrice, currency)}/month` : ""}</Link>
      </div>
      <p className="mt-3 text-[13px] text-muted">Paid securely through PayPal.</p>
    </div>
  );
}
