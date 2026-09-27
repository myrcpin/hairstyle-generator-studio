import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { ApiError, callFn, errorMessage } from "../lib/api";
import { newIdempotencyKey } from "../lib/device";
import type { Generation, Project as ProjectRow, Recommendation } from "../lib/types";
import { ConceptCard } from "../components/ConceptCard";
import { EmailGate } from "../components/EmailGate";
import { Paywall } from "../components/Paywall";
import { Alert, Modal, Spinner } from "../components/ui";
import { ALTERATION_PRESETS } from "../../supabase/functions/_shared/core/constants.ts";
import { messageFor } from "../../supabase/functions/_shared/core/errors.ts";

const PLAN_LABEL: Record<string, string> = { conservative: "Subtle", balanced: "Balanced", substantial: "Bolder change", extra: "Another idea" };

function useProjectData(id: string) {
  const [project, setProject] = useState<ProjectRow | null>(null);
  const [gens, setGens] = useState<Generation[]>([]);
  const [urls, setUrls] = useState<Record<string, string | null>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const urlFor = useRef<Set<string>>(new Set());

  const reload = useCallback(async () => {
    const [{ data: p, error }, { data: g }] = await Promise.all([
      supabase.from("projects").select("id,status,brief,recommendations,rejection_reason,saved,created_at,expires_at,org_id,client_label").eq("id", id).maybeSingle(),
      supabase.from("generations").select("id,project_id,parent_generation_id,generation_type,direction,view,recommendation,instruction,status,error_message,concept_only,created_at")
        .eq("project_id", id).in("generation_type", ["concept", "alteration"]).order("created_at"),
    ]);
    if (error || !p) { setLoadError(messageFor("not_found")); return; }
    setProject(p as ProjectRow);
    const list = (g ?? []) as Generation[];
    setGens(list);
    const done = list.filter((x) => x.status === "succeeded").map((x) => x.id);
    if (done.some((x) => !urlFor.current.has(x))) {
      const r = await callFn<{ generations: Record<string, string | null> }>("studio", { action: "urls", projectId: id }).catch(() => null);
      if (r) { setUrls(r.generations); done.forEach((x) => urlFor.current.add(x)); }
    }
  }, [id]);

  const pending = gens.some((g) => g.status === "queued" || g.status === "processing");
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => void reload(), 2500);
    return () => clearInterval(t);
  }, [pending, reload]);
  // signed URLs expire after an hour; refresh them periodically on long sessions
  useEffect(() => {
    const t = setInterval(() => { urlFor.current.clear(); void reload(); }, 45 * 60_000);
    return () => clearInterval(t);
  }, [reload]);

  return { project, gens, urls, reload, loadError, pending };
}

function progressMessage(gens: Generation[]): string {
  const total = gens.length;
  const ready = gens.filter((g) => g.status === "succeeded").length;
  const running = gens.some((g) => g.status === "processing");
  if (!running && ready === 0) return "Preparing your comparison…";
  if (ready === 0) return "Creating your first personalised look… this usually takes under a minute.";
  if (ready < total) return `${ready} of ${total} looks ready. Creating the rest…`;
  return "Your looks are ready.";
}

export default function Project() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { isVerified, allowance, refresh, ready } = useAuth();
  const { project, gens, urls, reload, loadError, pending } = useProjectData(id);
  const [error, setError] = useState<string | null>((location.state as { error?: string } | null)?.error ?? null);
  const [busy, setBusy] = useState(false);
  const [paywall, setPaywall] = useState<string | null>(null);
  const [alterFor, setAlterFor] = useState<Generation | null>(null);
  const autoStarted = useRef(false);

  const concepts = useMemo(() => gens.filter((g) => g.generation_type === "concept"), [gens]);
  const recs = (project?.recommendations ?? []) as Recommendation[];
  const hasConcepts = concepts.length > 0;
  const isSalon = !!project?.org_id;
  // Salon sessions are billed to the salon (server-enforced); personal projects use the person's plan.
  const paid = isSalon || !!allowance?.paid;

  const handleError = useCallback((e: unknown) => {
    if (!isSalon && e instanceof ApiError && (e.code === "paid_feature" || (e.code === "insufficient_credits" && !paid))) {
      setPaywall(e.code === "paid_feature" ? "Get more styles" : "You've used your free styles");
    } else setError(errorMessage(e));
  }, [paid, isSalon]);

  const startGeneration = useCallback(async (directions?: string[]) => {
    setError(null);
    setBusy(true);
    try {
      await callFn("studio", { action: "generate", projectId: id, idempotencyKey: newIdempotencyKey(), directions });
      await Promise.all([reload(), refresh()]);
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  }, [id, reload, refresh, handleError]);

  // After email verification, start the three free looks automatically (once).
  useEffect(() => {
    if (!ready || !project || !isVerified || hasConcepts || autoStarted.current) return;
    if (project.status !== "ready" || !recs.length) return;
    autoStarted.current = true;
    void startGeneration();
  }, [ready, project, isVerified, hasConcepts, recs.length, startGeneration]);

  useEffect(() => { if (!pending && hasConcepts) void refresh(); }, [pending, hasConcepts, refresh]);

  async function choose(g: Generation) {
    setBusy(true);
    setError(null);
    try {
      const r = await callFn<{ cardId: string; upgradeBlocked: string | null }>("studio", { action: "select", generationId: g.id });
      navigate(`/card/${r.cardId}`, { state: { upgradeBlocked: r.upgradeBlocked } });
    } catch (e) {
      handleError(e);
      setBusy(false);
    }
  }

  async function another(base?: Recommendation) {
    setBusy(true);
    setError(null);
    try {
      await callFn("studio", {
        action: "generate_another", projectId: id, idempotencyKey: newIdempotencyKey(),
        hint: base ? `Something in the spirit of "${base.name}" but noticeably different.` : undefined,
      });
      await Promise.all([reload(), refresh()]);
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  }

  if (loadError) return <div className="container-x py-16"><Alert>{loadError}</Alert><Link to="/start" className="btn-primary mt-6">Start a new project</Link></div>;
  if (!project) return <div className="container-x py-16"><Spinner label="Loading your project" /></div>;

  if (project.status === "expired") {
    return <div className="container-x py-16"><Alert tone="info">{messageFor("expired")}</Alert><Link to="/start" className="btn-primary mt-6">Start again</Link></div>;
  }
  if (project.status === "rejected") {
    return (
      <div className="container-x max-w-2xl py-16">
        <h1 className="text-[40px] leading-tight">Let's try a different photo.</h1>
        <div className="mt-4"><Alert>{messageFor(project.rejection_reason)}</Alert></div>
        <p className="mt-4 text-ink-2">Best results: front-facing photo, good lighting, face visible, hair visible, no heavy filters.</p>
        <Link to="/start" className="btn-primary mt-6">Upload another photo</Link>
      </div>
    );
  }
  if (!recs.length) {
    return (
      <div className="container-x max-w-2xl py-16">
        <h1 className="text-[40px] leading-tight">We didn't finish planning your looks.</h1>
        {error && <div className="mt-4"><Alert>{error}</Alert></div>}
        <p className="mt-4 text-ink-2">This can happen if the connection dropped. You haven't used any styles.</p>
        <Link to="/start" className="btn-primary mt-6">Start again</Link>
      </div>
    );
  }

  const byDirection = (d: string) => concepts.filter((g) => g.direction === d).at(-1) ?? null;
  const extraConcepts = concepts.filter((g) => g.direction === "extra");
  const alterations = gens.filter((g) => g.generation_type === "alteration");
  const freeDone = !paid && !isSalon && (allowance?.free.remaining ?? 0) <= 0;

  return (
    <div className="container-x py-10">
      <div className="mb-8 max-w-3xl">
        <p className="eyebrow">{isSalon ? `Client consultation${project.client_label ? ` · ${project.client_label}` : ""}` : "Your hairstyle plan"}</p>
        <h1 className="mt-2 text-[40px] leading-[1.05] sm:text-[52px]">{hasConcepts ? "Compare your looks." : "Three directions, planned for you."}</h1>
        {project.brief?.requested_change && <p className="mt-3 text-[17px] text-ink-2">You asked for: {project.brief.requested_change}</p>}
        {project.brief?.feasibility_warnings?.length ? (
          <div className="mt-4"><Alert tone="warn">{project.brief.feasibility_warnings.join(" ")}</Alert></div>
        ) : null}
      </div>

      {!hasConcepts && (
        <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr]">
          <ol className="space-y-4">
            {recs.filter((r) => r.direction !== "extra").map((r) => (
              <li key={r.direction} className="border border-line bg-card p-5">
                <p className="eyebrow">{PLAN_LABEL[r.direction]}</p>
                <h2 className="mt-1 text-[28px]">{r.name}</h2>
                <p className="mt-1 text-ink-2">{r.description}</p>
              </li>
            ))}
          </ol>
          <div className="border border-ink bg-card p-6">
            {!isVerified && !isSalon ? (
              <EmailGate title="Verify your email to see these on you." onVerified={() => undefined} />
            ) : (
              <div className="space-y-4">
                <h2 className="text-[30px] leading-tight">Ready to see them on you?</h2>
                <p className="text-ink-2">We'll create all three looks from {isSalon ? "your client's" : "your"} photo. This uses {isSalon ? "3 of your salon's looks" : paid ? "3 of your styles" : "your 3 free styles"}.</p>
                {busy ? <p role="status" className="flex items-center gap-3"><Spinner /> Starting…</p> : (
                  <button className="btn-primary" onClick={() => startGeneration()}>Create my 3 looks</button>
                )}
              </div>
            )}
            {error && <div className="mt-4"><Alert>{error}</Alert></div>}
          </div>
        </div>
      )}

      {hasConcepts && (
        <>
          <p role="status" aria-live="polite" className="mb-4 flex items-center gap-3 text-ink-2">
            {pending && <Spinner />} {progressMessage(concepts.concat(alterations))}
          </p>
          {error && <div className="mb-4"><Alert>{error}</Alert></div>}
          <div className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-4 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-3" aria-label="Your hairstyle concepts">
            {recs.filter((r) => r.direction !== "extra").map((rec) => {
              const g = byDirection(rec.direction);
              return (
                <ConceptCard key={rec.direction} gen={g} rec={rec} url={g ? urls[g.id] : null} watermark={!paid} busy={busy}
                  onChoose={() => g && choose(g)} onAlter={() => g && (paid ? setAlterFor(g) : setPaywall("Fine-tune a look"))}
                  onAnother={() => another(rec)} onRetry={() => startGeneration([rec.direction])} />
              );
            })}
            {extraConcepts.map((g) => (
              <ConceptCard key={g.id} gen={g} rec={g.recommendation!} url={urls[g.id]} watermark={!paid} busy={busy}
                onChoose={() => choose(g)} onAlter={() => (paid ? setAlterFor(g) : setPaywall("Fine-tune a look"))} onAnother={() => another(g.recommendation!)} />
            ))}
            {alterations.map((g) => (
              <ConceptCard key={g.id} gen={g} rec={g.recommendation!} url={urls[g.id]} watermark={!paid} busy={busy}
                onChoose={() => choose(g)} onAlter={() => setAlterFor(g)} />
            ))}
          </div>
          <p className="mt-2 text-[13px] text-muted">AI-generated visual concepts. Real results depend on your hair and your stylist.</p>
          {allowance && !isSalon && (
            <p className="mt-4 text-[14px] text-ink-2">
              {paid
                ? `${allowance.remaining.generations} new styles and ${allowance.remaining.alterations} alterations left.`
                : `${allowance.free.remaining} free style${allowance.free.remaining === 1 ? "" : "s"} left.`}
            </p>
          )}
          {freeDone && !pending && <div className="mt-8"><Paywall reason="Found one you like? Get the full Hairstyle Card." /></div>}
        </>
      )}

      <Modal open={!!paywall} onClose={() => setPaywall(null)} title="Unlock more styles">
        {paywall && <Paywall reason={paywall} compact />}
      </Modal>
      <AlterModal gen={alterFor} onClose={() => setAlterFor(null)} remaining={isSalon ? -1 : allowance?.remaining.alterations ?? 0}
        onDone={async () => { setAlterFor(null); await Promise.all([reload(), refresh()]); }} onError={handleError} />
    </div>
  );
}

function AlterModal({ gen, onClose, onDone, onError, remaining }: { gen: Generation | null; onClose: () => void; onDone: () => void; onError: (e: unknown) => void; remaining: number }) {
  const [presets, setPresets] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setPresets([]); setText(""); }, [gen?.id]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!gen || (!presets.length && !text.trim())) return;
    setBusy(true);
    try {
      await callFn("studio", { action: "alter", generationId: gen.id, presets, instruction: text, idempotencyKey: newIdempotencyKey() });
      onDone();
    } catch (err) {
      onClose();
      onError(err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open={!!gen} onClose={onClose} title="Change something">
      <form onSubmit={submit} className="space-y-4">
        <p className="text-ink-2">We'll adjust this look rather than start over.{remaining >= 0 ? ` ${remaining} alteration${remaining === 1 ? "" : "s"} left.` : ""}</p>
        <div className="flex flex-wrap gap-2">
          {ALTERATION_PRESETS.map((p) => (
            <button type="button" key={p} className="chip" aria-pressed={presets.includes(p)} onClick={() => setPresets((xs) => xs.includes(p) ? xs.filter((x) => x !== p) : [...xs, p])}>{p}</button>
          ))}
        </div>
        <div>
          <label htmlFor="alter-text" className="mb-1 block text-[14px] font-medium">Anything else? <span className="font-normal text-muted">(optional)</span></label>
          <input id="alter-text" className="input" maxLength={300} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. a little shorter at the back" />
        </div>
        <button className="btn-primary w-full" disabled={busy || remaining === 0 || (!presets.length && !text.trim())}>{busy ? <Spinner label="Starting" /> : "Apply changes"}</button>
      </form>
    </Modal>
  );
}
