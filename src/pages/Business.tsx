import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { callFn, errorMessage } from "../lib/api";
import { usePublicConfig } from "../lib/publicConfig";
import { Alert, PageTitle, Spinner } from "../components/ui";
import { CurrencySwitch } from "./Pricing";
import { formatPrice } from "../../supabase/functions/_shared/core/pricing.ts";

interface MyOrg { id: string; name: string; role: string; subscription_status: string }

export default function Business() {
  const { session, isVerified } = useAuth();
  const { businessPlans, currency } = usePublicConfig();
  const navigate = useNavigate();
  const [orgs, setOrgs] = useState<MyOrg[] | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [bookingUrl, setBookingUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session && isVerified) callFn<{ orgs: MyOrg[] }>("business", { action: "my_orgs" }).then((r) => setOrgs(r.orgs)).catch(() => setOrgs([]));
  }, [session, isVerified]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await callFn<{ orgId: string }>("business", { action: "create_org", name, slug, bookingUrl: bookingUrl || null });
      navigate(`/business/dashboard?org=${r.orgId}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="container-x py-12">
      <PageTitle eyebrow="For salons & barbershops" title="Consultations your clients can see.">
        Show clients their new cut on their own photo before you pick up the scissors — then hand them a branded Hairstyle Card with the cutting notes, angles and your booking link.
      </PageTitle>

      <section className="grid gap-6 md:grid-cols-3">
        {[
          ["Fewer miscommunicated cuts", "Agree the look on a realistic preview of the client, not a stranger's photo from social media."],
          ["Your brand on every card", "Cards carry your salon name, logo and booking link. Clients share them — with your name on."],
          ["Built for the chair", "Works on the salon iPad or your phone. Take the photo, describe, compare three looks, choose, done."],
        ].map(([t, d]) => (
          <div key={t} className="border-t border-ink pt-4">
            <h2 className="text-[26px] leading-tight">{t}</h2>
            <p className="mt-2 text-ink-2">{d}</p>
          </div>
        ))}
      </section>

      <section className="mt-12">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-[36px]">Plans</h2>
          <CurrencySwitch />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {businessPlans.map((p) => (
            <div key={p.code} className="border border-line bg-card p-6">
              <h3 className="text-[32px]">{p.name}</h3>
              <p className="mt-1 text-[28px]">{p.prices[currency] ? formatPrice(p.prices[currency]!.amount, currency) : "—"}<span className="text-[16px] text-muted">/month</span></p>
              {p.description && <p className="mt-2 text-ink-2">{p.description}</p>}
              <ul className="mt-4 space-y-1.5 text-[15px] text-ink-2">
                <li>✓ {p.generations} client looks a month</li>
                <li>✓ {p.alterations} alterations</li>
                <li>✓ {p.card_builds} full branded Hairstyle Cards</li>
                <li>✓ Up to {p.max_members} staff logins</li>
                <li>✓ Email cards to clients · QR · downloads</li>
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[13px] text-muted">Billed monthly by PayPal. Cancel any time. Prices exclude VAT where applicable.</p>
      </section>

      <section className="mt-12 grid gap-8 lg:grid-cols-2">
        <div>
          <h2 className="text-[36px] leading-tight">Set up your salon</h2>
          <p className="mt-2 text-ink-2">Create your salon, choose a plan, then invite your team.</p>
          {orgs && orgs.length > 0 && (
            <ul className="mt-6 space-y-2">
              {orgs.map((o) => (
                <li key={o.id}><Link to={`/business/dashboard?org=${o.id}`} className="btn-secondary w-full justify-between">{o.name}<span className="text-[13px] text-muted">{o.role} · {o.subscription_status}</span></Link></li>
              ))}
            </ul>
          )}
        </div>
        <div className="border border-ink bg-card p-6">
          {!session || !isVerified ? (
            <div className="space-y-3">
              <p className="text-ink-2">Sign in with your work email to create a salon account.</p>
              <Link to="/signin?next=/business" className="btn-primary">Sign in</Link>
            </div>
          ) : (
            <form onSubmit={create} className="space-y-3" noValidate>
              <div>
                <label htmlFor="org-name" className="mb-1 block text-[14px] font-medium">Salon name</label>
                <input id="org-name" className="input" value={name} maxLength={80} onChange={(e) => {
                  setName(e.target.value);
                  setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40));
                }} />
              </div>
              <div>
                <label htmlFor="org-slug" className="mb-1 block text-[14px] font-medium">Short name <span className="font-normal text-muted">(letters, numbers, dashes)</span></label>
                <input id="org-slug" className="input" value={slug} maxLength={40} onChange={(e) => setSlug(e.target.value.toLowerCase())} />
              </div>
              <div>
                <label htmlFor="org-booking" className="mb-1 block text-[14px] font-medium">Booking link <span className="font-normal text-muted">(optional, https://…)</span></label>
                <input id="org-booking" className="input" type="url" value={bookingUrl} onChange={(e) => setBookingUrl(e.target.value)} placeholder="https://" />
              </div>
              {error && <Alert>{error}</Alert>}
              <button className="btn-primary w-full" disabled={busy || name.trim().length < 2 || slug.length < 3}>{busy ? <Spinner /> : "Create salon account"}</button>
            </form>
          )}
        </div>
      </section>
    </div>
  );
}
