import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { callFn, errorMessage } from "../lib/api";
import { supabase } from "../lib/supabase";
import { usePublicConfig } from "../lib/publicConfig";
import { Alert, Badge, PageTitle, Spinner } from "../components/ui";
import { CurrencySwitch } from "./Pricing";
import { formatPrice } from "../../supabase/functions/_shared/core/pricing.ts";

type Counter = { limit: number; used: number; remaining: number };
interface OrgPayload {
  role: "owner" | "stylist";
  org: { id: string; name: string; slug: string; booking_url: string | null; logo_url: string | null; plan_code: string | null; subscription_status: string; current_period_end: string | null };
  allowance: { active: boolean; members: number; max_members: number; generations: Counter; alterations: Counter; card_builds: Counter };
  members: { userId: string; role: string; email: string | null; you: boolean }[];
  sessions: { id: string; clientLabel: string | null; status: string; createdAt: string; cardId: string | null }[];
}

export default function BusinessDashboard() {
  const [params] = useSearchParams();
  const orgId = params.get("org") ?? "";
  const { ready, session, isVerified } = useAuth();
  const { businessPlans, currency } = usePublicConfig();
  const [d, setD] = useState<OrgPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [invite, setInvite] = useState<string | null>(null);
  const [booking, setBooking] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await callFn<OrgPayload>("business", { action: "get_org", orgId });
      setD(r);
      setBooking(r.org.booking_url ?? "");
    } catch (e) { setError(errorMessage(e)); }
  }, [orgId]);

  useEffect(() => { if (session && isVerified && orgId) void load(); }, [session, isVerified, orgId, load]);

  // Returning from PayPal: confirm with PayPal server-side.
  useEffect(() => {
    if (params.get("billing") !== "return" || !orgId || !session) return;
    callFn<{ status: string }>("billing", { action: "confirm", orgId })
      .then((r) => { setNotice(r.status === "active" ? "Your salon plan is active." : "Waiting for PayPal to confirm the first payment…"); void load(); })
      .catch((e) => setError(errorMessage(e)));
  }, [params, orgId, session, load]);

  if (!ready) return <div className="container-x py-16"><Spinner /></div>;
  if (!session || !isVerified) return <Navigate to={`/signin?next=/business/dashboard?org=${orgId}`} replace />;
  if (error && !d) return <div className="container-x py-16"><Alert>{error}</Alert><Link to="/business" className="btn-secondary mt-4">Back</Link></div>;
  if (!d) return <div className="container-x py-16"><Spinner label="Loading salon" /></div>;

  const owner = d.role === "owner";
  async function run(name: string, fn: () => Promise<void>) {
    setBusy(name); setError(null); setNotice(null);
    try { await fn(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(null); }
  }

  async function uploadLogo(file: File) {
    await run("logo", async () => {
      const r = await callFn<{ path: string; token: string }>("business", { action: "logo_upload", orgId, contentType: file.type, size: file.size });
      const { error: e } = await supabase.storage.from("brand").uploadToSignedUrl(r.path, r.token, file, { contentType: file.type });
      if (e) throw new Error("upload");
      await callFn("business", { action: "logo_confirm", orgId, path: r.path });
      await load();
      setNotice("Logo updated. New cards will show it.");
    });
  }

  const statusTone = d.allowance.active ? "ok" : "warn";
  return (
    <div className="container-x py-10">
      <PageTitle eyebrow="Salon dashboard" title={d.org.name} />
      {error && <div className="mb-4"><Alert>{error}</Alert></div>}
      {notice && <div className="mb-4"><Alert tone="ok">{notice}</Alert></div>}

      <section className="grid gap-4 md:grid-cols-[1.3fr_1fr]">
        <div className="border border-line bg-card p-5">
          <div className="flex items-center gap-3"><p className="eyebrow">Plan</p><Badge tone={statusTone}>{d.org.subscription_status}</Badge></div>
          {d.allowance.active ? (
            <>
              <dl className="mt-3 grid grid-cols-3 gap-3 text-[14px]">
                {(["generations", "alterations", "card_builds"] as const).map((k) => (
                  <div key={k}><dt className="text-muted">{k === "generations" ? "Client looks" : k === "alterations" ? "Alterations" : "Full cards"}</dt>
                    <dd className="font-display text-[30px] leading-none text-ink">{d.allowance[k].remaining}<span className="text-[14px] text-muted"> / {d.allowance[k].limit}</span></dd></div>
                ))}
              </dl>
              <p className="mt-3 text-[13px] text-muted">{d.org.current_period_end ? `Renews ${new Date(d.org.current_period_end).toLocaleDateString()}. ` : ""}Staff: {d.allowance.members}/{d.allowance.max_members}.</p>
              <Link to={`/start?org=${orgId}`} className="btn-primary mt-4">New client consultation</Link>
              {owner && d.org.subscription_status === "active" && (
                <button className="btn-ghost mt-2" onClick={() => confirm("Cancel the salon plan? It stays active until the end of the paid period.") && run("cancel", async () => { await callFn("billing", { action: "cancel", orgId }); await load(); setNotice("Salon plan cancelled."); })}>Cancel plan</button>
              )}
            </>
          ) : owner ? (
            <div className="mt-3 space-y-3">
              <p className="text-ink-2">Choose a plan to start client consultations.</p>
              <CurrencySwitch />
              <div className="grid gap-2 sm:grid-cols-2">
                {businessPlans.map((p) => (
                  <button key={p.code} className="btn-secondary h-auto flex-col items-start py-3 text-left" disabled={!!busy}
                    onClick={() => run(p.code, async () => {
                      const r = await callFn<{ approveUrl?: string; alreadyActive?: boolean }>("billing", { action: "create_subscription", orgId, plan: p.code, currency });
                      if (r.approveUrl) window.location.assign(r.approveUrl); else await load();
                    })}>
                    <span className="font-medium">{p.name} — {p.prices[currency] ? formatPrice(p.prices[currency]!.amount, currency) : "—"}/month</span>
                    <span className="text-[13px] opacity-80">{p.generations} looks · {p.max_members} staff</span>
                  </button>
                ))}
              </div>
            </div>
          ) : <p className="mt-3 text-ink-2">Your salon's plan isn't active. Ask the owner to check billing.</p>}
        </div>

        <div className="border border-line bg-card p-5">
          <p className="eyebrow">Branding</p>
          <div className="mt-3 flex items-center gap-4">
            {d.org.logo_url ? <img src={d.org.logo_url} alt={`${d.org.name} logo`} className="h-14 w-auto max-w-[160px] object-contain" /> : <span className="text-[14px] text-muted">No logo yet</span>}
            {owner && (
              <label className="btn-secondary min-h-10 cursor-pointer px-4">
                {busy === "logo" ? <Spinner /> : "Upload logo"}
                <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadLogo(f); }} />
              </label>
            )}
          </div>
          {owner && (
            <form className="mt-4 space-y-2" onSubmit={(e) => { e.preventDefault(); void run("booking", async () => { await callFn("business", { action: "update_org", orgId, bookingUrl: booking || null }); await load(); setNotice("Booking link saved."); }); }}>
              <label htmlFor="booking" className="block text-[14px] font-medium">Booking link on cards</label>
              <div className="flex gap-2">
                <input id="booking" className="input min-h-10 flex-1" type="url" value={booking} onChange={(e) => setBooking(e.target.value)} placeholder="https://" />
                <button className="btn-secondary min-h-10 px-4" disabled={!!busy}>Save</button>
              </div>
            </form>
          )}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-[32px]">Recent consultations</h2>
        {d.sessions.length === 0 ? <p className="mt-3 text-ink-2">No consultations yet.</p> : (
          <ul className="mt-3 divide-y divide-line border-y border-line">
            {d.sessions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <Link to={`/project/${s.id}`} className="text-[17px] underline-offset-4 hover:underline">{s.clientLabel || "Client"}</Link>
                  <p className="text-[13px] text-muted">{new Date(s.createdAt).toLocaleString()} · {s.status}</p>
                </div>
                {s.cardId && <Link to={`/card/${s.cardId}`} className="btn-secondary min-h-10 px-4">Card</Link>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-[32px]">Team</h2>
        <ul className="mt-3 divide-y divide-line border-y border-line">
          {d.members.map((m) => (
            <li key={m.userId} className="flex items-center justify-between py-3 text-[15px]">
              <span>{m.email ?? "Team member"}{m.you ? " (you)" : ""} · <span className="text-muted">{m.role}</span></span>
              {owner && !m.you && <button className="btn-ghost min-h-10 text-bad" onClick={() => run("remove", async () => { await callFn("business", { action: "remove_member", orgId, userId: m.userId }); await load(); })}>Remove</button>}
            </li>
          ))}
        </ul>
        {owner && (
          <div className="mt-4 space-y-2">
            <button className="btn-secondary min-h-10" disabled={!!busy} onClick={() => run("invite", async () => { const r = await callFn<{ link: string }>("business", { action: "create_invite", orgId }); setInvite(r.link); })}>Create staff invite link</button>
            {invite && <p className="break-all text-[14px] text-ink-2">Send this link to your stylist (valid 7 days, single use): <strong>{invite}</strong></p>}
          </div>
        )}
      </section>
    </div>
  );
}
