import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { callFn, errorMessage } from "../lib/api";
import type { Project } from "../lib/types";
import { Alert, Badge, Modal, PageTitle, Spinner } from "../components/ui";

interface CardRow { id: string; project_id: string; tier: string; card_data: { style_name: string }; created_at: string; revoked_at: string | null }

const STATUS_TEXT: Record<string, string> = {
  none: "Free", pending: "Waiting for PayPal confirmation", active: "Plus — active", past_due: "Plus — payment problem",
  suspended: "Plus — suspended (payment failed)", cancelled: "Plus — cancelled", expired: "Plus — expired",
};

export default function Account() {
  const { ready, session, isVerified, profile, allowance, refresh, signOut } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [cards, setCards] = useState<CardRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteText, setDeleteText] = useState("");

  const load = useCallback(async () => {
    const [{ data: p }, { data: c }] = await Promise.all([
      supabase.from("projects").select("id,status,brief,recommendations,rejection_reason,saved,created_at,expires_at").order("created_at", { ascending: false }).limit(50),
      supabase.from("style_cards").select("id,project_id,tier,card_data,created_at,revoked_at").order("created_at", { ascending: false }).limit(50),
    ]);
    setProjects((p ?? []) as Project[]);
    setCards((c ?? []) as CardRow[]);
  }, []);
  useEffect(() => { if (session) void load(); }, [session, load]);

  if (!ready) return <div className="container-x py-16"><Spinner /></div>;
  if (!session || !isVerified) return <Navigate to="/signin?next=/account" replace />;

  async function run(name: string, fn: () => Promise<void>) {
    setBusy(name); setError(null); setNotice(null);
    try { await fn(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(null); }
  }

  const status = profile?.subscription_status ?? "none";
  const periodEnd = profile?.current_period_end ? new Date(profile.current_period_end).toLocaleDateString() : null;
  const cardByProject = new Map(cards.map((c) => [c.project_id, c]));

  return (
    <div className="container-x max-w-4xl py-10">
      <PageTitle eyebrow="Account" title="My styles" />
      {error && <div className="mb-4"><Alert>{error}</Alert></div>}
      {notice && <div className="mb-4"><Alert tone="ok">{notice}</Alert></div>}

      <section className="grid gap-4 border border-line bg-card p-5 sm:grid-cols-2">
        <div>
          <p className="eyebrow">Plan</p>
          <p className="mt-1 text-[22px]">{STATUS_TEXT[status]}</p>
          {status === "cancelled" && periodEnd && <p className="text-[14px] text-ink-2">You keep Plus until {periodEnd}.</p>}
          {status === "active" && periodEnd && <p className="text-[14px] text-ink-2">Renews {periodEnd}.</p>}
          {(status === "suspended" || status === "past_due") && <p className="text-[14px] text-bad">Please update your payment method in PayPal to keep Plus.</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {!allowance?.paid && <Link to="/pricing" className="btn-primary min-h-10">Get Plus</Link>}
            {["active", "past_due", "suspended"].includes(status) && <button className="btn-ghost -ml-3" onClick={() => setConfirmCancel(true)}>Cancel subscription</button>}
          </div>
        </div>
        <div>
          <p className="eyebrow">This period</p>
          {allowance ? (
            <ul className="mt-1 space-y-1 text-[15px]">
              {allowance.paid ? (
                <>
                  <li>{allowance.subscription.generations.used} of {allowance.subscription.generations.limit} new styles used</li>
                  <li>{allowance.subscription.alterations.used} of {allowance.subscription.alterations.limit} alterations used</li>
                  <li>{allowance.subscription.card_builds.used} of {allowance.subscription.card_builds.limit} full cards built</li>
                </>
              ) : <li>{allowance.free.used} of {allowance.free.limit} free styles used</li>}
            </ul>
          ) : <Spinner />}
          <p className="mt-3 text-[13px] text-muted">Signed in as {profile?.email}</p>
        </div>
      </section>

      <section className="mt-10">
        <div className="flex items-end justify-between">
          <h2 className="text-[32px]">Projects</h2>
          <Link to="/start" className="btn-secondary min-h-10">New project</Link>
        </div>
        {projects.length === 0 ? <p className="mt-4 text-ink-2">No projects yet.</p> : (
          <ul className="mt-4 divide-y divide-line border-y border-line">
            {projects.map((p) => {
              const card = cardByProject.get(p.id);
              const name = card?.card_data.style_name ?? p.recommendations?.[0]?.name ?? "Untitled project";
              return (
                <li key={p.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <Link to={p.status === "expired" ? "#" : `/project/${p.id}`} className="text-[18px] underline-offset-4 hover:underline">{name}</Link>
                    <p className="text-[13px] text-muted">
                      {new Date(p.created_at).toLocaleDateString()} · {p.status === "expired" ? "Expired — images deleted" : `Images deleted ${new Date(p.expires_at).toLocaleDateString()}`}
                      {p.saved && " · Saved"}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {card && <Link to={`/card/${card.id}`} className="btn-secondary min-h-10 px-4">Card{card.tier === "preview" ? " (preview)" : ""}</Link>}
                    {allowance?.paid && p.status !== "expired" && (
                      <button className="btn-ghost min-h-10" disabled={!!busy} onClick={() => run(`save-${p.id}`, async () => {
                        await callFn("studio", { action: "save_project", projectId: p.id, saved: !p.saved }); await load();
                      })}>{p.saved ? "Unsave" : "Save"}</button>
                    )}
                    <button className="btn-ghost min-h-10 text-bad" disabled={!!busy} onClick={() => {
                      if (!confirm("Delete this project and all its photos? This can't be undone.")) return;
                      void run(`del-${p.id}`, async () => { await callFn("studio", { action: "delete_project", projectId: p.id }); await load(); setNotice("Project and photos deleted."); });
                    }}>{busy === `del-${p.id}` ? <Spinner /> : "Delete"}</button>
                    {card?.revoked_at && <Badge>Sharing off</Badge>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mt-12 border-t border-line pt-6">
        <h2 className="text-[26px]">Privacy</h2>
        <p className="mt-2 text-[15px] text-ink-2">Original photos are deleted automatically a few days after upload; generated looks after 30 days unless you save them. You can delete everything now.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="btn-secondary" onClick={() => signOut().then(() => navigate("/"))}>Sign out</button>
          <button className="btn-ghost text-bad" onClick={() => setConfirmDelete(true)}>Delete my account</button>
        </div>
      </section>

      <Modal open={confirmCancel} onClose={() => setConfirmCancel(false)} title="Cancel Plus?">
        <p className="text-ink-2">You'll keep Plus until the end of the current period{periodEnd ? ` (${periodEnd})` : ""}. You won't be charged again.</p>
        <div className="mt-5 flex gap-2">
          <button className="btn-primary" disabled={!!busy} onClick={() => run("cancel", async () => {
            await callFn("billing", { action: "cancel" }); await refresh(); setConfirmCancel(false); setNotice("Your subscription is cancelled. No further payments will be taken.");
          })}>{busy === "cancel" ? <Spinner /> : "Cancel subscription"}</button>
          <button className="btn-ghost" onClick={() => setConfirmCancel(false)}>Keep Plus</button>
        </div>
      </Modal>

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete your account?">
        <p className="text-ink-2">This cancels any subscription, deletes all your photos, looks and cards, and closes your account. Payment records we must keep by law are retained without your photos.</p>
        <label htmlFor="del-confirm" className="mt-4 block text-[14px] font-medium">Type DELETE to confirm</label>
        <input id="del-confirm" className="input mt-1" value={deleteText} onChange={(e) => setDeleteText(e.target.value)} />
        <button className="btn-primary mt-4 bg-bad hover:bg-bad/90" disabled={deleteText !== "DELETE" || !!busy} onClick={() => run("delete", async () => {
          await callFn("studio", { action: "delete_account", confirm: "DELETE" }); await signOut(); navigate("/");
        })}>{busy === "delete" ? <Spinner /> : "Delete everything"}</button>
      </Modal>
    </div>
  );
}
