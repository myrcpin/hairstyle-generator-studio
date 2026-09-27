import { useCallback, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { callFn, errorMessage } from "../lib/api";
import { Alert, PageTitle, Spinner } from "../components/ui";
import { ANALYTICS_EVENTS } from "../../supabase/functions/_shared/core/constants.ts";

type Growth = { packs_sold: number; referral_signups: number; referrals_qualified: number; referral_rewards: number; organizations: number; organizations_active: number; business_sessions_30d: number };
interface SurveySummary { completions: number; eligible: number; questions: { key: string; prompt: string; active: boolean; answers: Record<string, number> }[] }
type Stats = Record<string, unknown> & { funnel_30d: Record<string, number>; revenue: Record<string, number>; revenue_30d: Record<string, number>; subscriptions: Record<string, number> };
interface SettingRow { key: string; value: Record<string, unknown>; updated_at: string }
interface PlanRow { code: string; name: string; kind: string; active: boolean; generations: number; alterations: number; card_builds: number; prices: Record<string, { amount: string; paypal_plan_id: string | null }> }

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border border-line bg-card p-4">
      <p className="text-[12px] uppercase tracking-[0.12em] text-muted">{label}</p>
      <p className="mt-1 font-display text-[36px] leading-none text-ink">{value}</p>
      {sub && <p className="mt-1 text-[13px] text-ink-2">{sub}</p>}
    </div>
  );
}

const n = (v: unknown) => (typeof v === "number" ? v.toLocaleString() : String(v ?? "—"));
const money = (m: Record<string, number>) => Object.entries(m ?? {}).map(([c, v]) => `${c} ${Number(v).toFixed(2)}`).join(" · ") || "—";
const bytes = (b: number) => (b > 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${(b / 1e6).toFixed(1)} MB`);

function SettingEditor({ row, onSaved }: { row: SettingRow; onSaved: () => void }) {
  const [draft, setDraft] = useState<Record<string, unknown>>(row.value);
  const [msg, setMsg] = useState<string | null>(null);
  const save = async () => {
    setMsg(null);
    try { await callFn("admin", { action: "update_setting", key: row.key, value: draft }); setMsg("Saved"); onSaved(); } catch (e) { setMsg(errorMessage(e)); }
  };
  return (
    <fieldset className="border border-line bg-card p-4">
      <legend className="px-1 font-medium">{row.key.replace(/_/g, " ")}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {Object.entries(draft).map(([k, v]) => (
          <label key={k} className="text-[13px]">
            <span className="text-muted">{k.replace(/_/g, " ")}</span>
            {typeof v === "boolean" ? (
              <input type="checkbox" className="ml-2 h-4 w-4 accent-ink" checked={v} onChange={(e) => setDraft({ ...draft, [k]: e.target.checked })} />
            ) : typeof v === "object" ? (
              <textarea className="input mt-1 min-h-20 py-2 font-mono text-[12px]" defaultValue={JSON.stringify(v)} onBlur={(e) => { try { setDraft({ ...draft, [k]: JSON.parse(e.target.value) }); } catch { setMsg(`${k}: invalid JSON`); } }} />
            ) : (
              <input className="input mt-1 min-h-10" value={String(v)} onChange={(e) => setDraft({ ...draft, [k]: typeof v === "number" ? Number(e.target.value) : e.target.value })} />
            )}
          </label>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button className="btn-secondary min-h-10 px-4" onClick={save}>Save</button>
        {msg && <span role="status" className="text-[13px] text-ink-2">{msg}</span>}
      </div>
    </fieldset>
  );
}

function PlanEditor({ plan, onSaved }: { plan: PlanRow; onSaved: () => void }) {
  const [p, setP] = useState(plan);
  const [msg, setMsg] = useState<string | null>(null);
  const save = async () => {
    setMsg(null);
    try {
      await callFn("admin", { action: "update_plan", code: p.code, plan: { name: p.name, active: p.active, generations: p.generations, alterations: p.alterations, card_builds: p.card_builds, prices: p.prices } });
      setMsg("Saved"); onSaved();
    } catch (e) { setMsg(errorMessage(e)); }
  };
  return (
    <fieldset className="border border-line bg-card p-4">
      <legend className="px-1 font-medium">Plan: {p.code} ({p.kind})</legend>
      <div className="grid gap-3 sm:grid-cols-4">
        {(["generations", "alterations", "card_builds"] as const).map((k) => (
          <label key={k} className="text-[13px]"><span className="text-muted">{k}</span>
            <input className="input mt-1 min-h-10" type="number" min={0} value={p[k]} onChange={(e) => setP({ ...p, [k]: Number(e.target.value) })} /></label>
        ))}
        <label className="text-[13px]"><span className="text-muted">active</span>
          <input type="checkbox" className="ml-2 h-4 w-4 accent-ink" checked={p.active} onChange={(e) => setP({ ...p, active: e.target.checked })} /></label>
        {Object.entries(p.prices).map(([cur, v]) => (
          <div key={cur} className="grid grid-cols-2 gap-2 sm:col-span-2">
            <label className="text-[13px]"><span className="text-muted">{cur} price</span>
              <input className="input mt-1 min-h-10" value={v.amount} onChange={(e) => setP({ ...p, prices: { ...p.prices, [cur]: { ...v, amount: e.target.value } } })} /></label>
            <label className="text-[13px]"><span className="text-muted">{cur} PayPal plan id</span>
              <input className="input mt-1 min-h-10" value={v.paypal_plan_id ?? ""} placeholder="P-XXXXXXXX" onChange={(e) => setP({ ...p, prices: { ...p.prices, [cur]: { ...v, paypal_plan_id: e.target.value || null } } })} /></label>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[12px] text-muted">New subscribers are charged the price above (sent to PayPal as a plan override). Existing subscribers keep their price until changed in PayPal. Each currency needs a PayPal plan in that currency.</p>
      <div className="mt-3 flex items-center gap-3">
        <button className="btn-secondary min-h-10 px-4" onClick={save}>Save plan</button>
        {msg && <span role="status" className="text-[13px] text-ink-2">{msg}</span>}
      </div>
    </fieldset>
  );
}

export default function Admin() {
  const { ready, profile } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [growth, setGrowth] = useState<Growth | null>(null);
  const [survey, setSurvey] = useState<SurveySummary | null>(null);
  const [failures, setFailures] = useState<{ error_code: string; generation_type: string; model: string; created_at: string }[]>([]);
  const [settings, setSettings] = useState<SettingRow[]>([]);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, c, sv] = await Promise.all([
        callFn<{ stats: Stats; growth: Growth; recentFailures: typeof failures }>("admin", { action: "stats" }),
        callFn<{ settings: SettingRow[]; plans: PlanRow[] }>("admin", { action: "get_settings" }),
        callFn<SurveySummary>("admin", { action: "survey" }),
      ]);
      setStats(s.stats); setGrowth(s.growth); setSurvey(sv); setFailures(s.recentFailures); setSettings(c.settings); setPlans(c.plans);
    } catch (e) { setError(errorMessage(e)); }
  }, []);
  useEffect(() => { if (profile?.is_admin) void load(); }, [profile?.is_admin, load]);

  if (!ready) return <div className="container-x py-16"><Spinner /></div>;
  if (!profile?.is_admin) return <Navigate to="/" replace />;

  return (
    <div className="container-x py-10">
      <PageTitle eyebrow="Admin" title="Dashboard" />
      {error && <Alert>{error}</Alert>}
      {!stats ? <Spinner /> : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile label="Users (verified)" value={n(stats.users_total)} sub={`${n(stats.users_anonymous)} anonymous`} />
            <Tile label="Paid users" value={n(stats.users_paid)} sub={`${n(stats.users_free)} free`} />
            <Tile label="Conversion" value={`${(Number(stats.conversion_rate) * 100).toFixed(1)}%`} sub="verified → subscribed" />
            <Tile label="Avg generations / user" value={n(stats.avg_generations_per_user)} />
            <Tile label="Generations" value={n(stats.generations)} sub={`${n(stats.card_views)} card views`} />
            <Tile label="Alterations" value={n(stats.alterations)} />
            <Tile label="Generation failures" value={n(stats.generation_failures)} />
            <Tile label="Est. API cost" value={`$${Number(stats.api_cost_usd).toFixed(2)}`} sub={`$${Number(stats.api_cost_usd_30d).toFixed(2)} last 30 days`} />
            <Tile label="Revenue" value={money(stats.revenue)} sub={`30 days: ${money(stats.revenue_30d)}`} />
            <Tile label="Cards" value={n(stats.cards)} />
            <Tile label="Storage" value={bytes(Number(stats.storage_bytes))} sub={`${n(stats.storage_objects)} objects`} />
            <Tile label="Subscriptions" value={n(stats.subscriptions?.active ?? 0)} sub={Object.entries(stats.subscriptions ?? {}).map(([k, v]) => `${k}: ${v}`).join(" · ")} />
          </div>

          {growth && (
            <>
              <h2 className="mt-10 text-[30px]">Growth</h2>
              <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                <Tile label="Starter Packs sold" value={n(growth.packs_sold)} />
                <Tile label="Referral sign-ups" value={n(growth.referral_signups)} sub={`${n(growth.referrals_qualified)} bought a pack`} />
                <Tile label="Free months awarded" value={n(growth.referral_rewards)} />
                <Tile label="Salons" value={n(growth.organizations_active)} sub={`${n(growth.organizations)} created · ${n(growth.business_sessions_30d)} sessions in 30 days`} />
              </div>
            </>
          )}

          {survey && (
            <>
              <div className="mt-10 flex flex-wrap items-end justify-between gap-3">
                <h2 className="text-[30px]">Customer survey</h2>
                <button className="btn-secondary min-h-10 px-4" onClick={async () => {
                  const r = await callFn<{ csv: string }>("admin", { action: "survey_csv" });
                  const a = document.createElement("a");
                  a.href = URL.createObjectURL(new Blob([r.csv], { type: "text/csv" }));
                  a.download = "survey-responses.csv";
                  a.click();
                }}>Download CSV (pseudonymised)</button>
              </div>
              <p className="mt-1 text-[14px] text-ink-2">{n(survey.completions)} completed of {n(survey.eligible)} paying customers ({survey.eligible ? Math.round((survey.completions / survey.eligible) * 100) : 0}%). Up to 5 questions can be active.</p>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                {survey.questions.map((q) => {
                  const total = Object.values(q.answers).reduce((a, b) => a + b, 0);
                  return (
                    <div key={q.key} className="border border-line bg-card p-4">
                      <div className="flex items-start justify-between gap-3">
                        <p className="font-medium">{q.prompt}</p>
                        <label className="flex shrink-0 items-center gap-2 text-[13px] text-muted">
                          <input type="checkbox" className="h-4 w-4 accent-ink" checked={q.active} onChange={async (e) => {
                            try { await callFn("admin", { action: "update_survey_question", key: q.key, active: e.target.checked }); await load(); } catch (err) { setError(errorMessage(err)); }
                          }} />Active
                        </label>
                      </div>
                      {total === 0 ? <p className="mt-2 text-[13px] text-muted">No answers yet.</p> : (
                        <table className="mt-2 w-full text-[14px]">
                          <tbody>
                            {Object.entries(q.answers).sort((a, b) => b[1] - a[1]).map(([ans, c]) => (
                              <tr key={ans} className="border-t border-line/60"><td className="py-1">{ans.replace(/_/g, " ")}</td><td className="py-1 text-right tabular-nums">{c}</td><td className="w-14 py-1 text-right tabular-nums text-muted">{Math.round((c / total) * 100)}%</td></tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          <h2 className="mt-10 text-[30px]">Funnel (last 30 days)</h2>
          <table className="mt-3 w-full max-w-xl text-left text-[14px]">
            <thead><tr className="border-b border-line text-muted"><th className="py-2 font-medium">Event</th><th className="py-2 text-right font-medium">Count</th></tr></thead>
            <tbody>
              {ANALYTICS_EVENTS.map((e) => (
                <tr key={e} className="border-b border-line/60"><td className="py-1.5">{e.replace(/_/g, " ")}</td><td className="py-1.5 text-right tabular-nums">{n(stats.funnel_30d?.[e] ?? 0)}</td></tr>
              ))}
            </tbody>
          </table>

          <h2 className="mt-10 text-[30px]">Recent failures</h2>
          {failures.length === 0 ? <p className="mt-2 text-ink-2">None.</p> : (
            <table className="mt-3 w-full text-left text-[14px]">
              <thead><tr className="border-b border-line text-muted"><th className="py-2 font-medium">When</th><th className="font-medium">Type</th><th className="font-medium">Model</th><th className="font-medium">Code</th></tr></thead>
              <tbody>{failures.map((f, i) => <tr key={i} className="border-b border-line/60"><td className="py-1.5">{new Date(f.created_at).toLocaleString()}</td><td>{f.generation_type}</td><td>{f.model}</td><td>{f.error_code}</td></tr>)}</tbody>
            </table>
          )}
        </>
      )}

      <h2 className="mt-10 text-[30px]">Configuration</h2>
      <div className="mt-4 grid gap-4">
        {plans.map((p) => <PlanEditor key={p.code} plan={p} onSaved={load} />)}
        {settings.map((s) => <SettingEditor key={s.key + s.updated_at} row={s} onSaved={load} />)}
      </div>
    </div>
  );
}
