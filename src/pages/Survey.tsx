import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { callFn, errorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Alert, PageTitle, Spinner } from "../components/ui";
import { optionsFor, type SurveyQuestion } from "../../supabase/functions/_shared/core/survey.ts";

interface SurveyPayload { eligible: boolean; completed: boolean; currency: string | null; questions: SurveyQuestion[]; rewardGenerations: number }

const SYMBOL: Record<string, string> = { GBP: "£", USD: "$" };

/** Five tap-to-answer questions shown after a purchase. One question per screen on mobile keeps it quick. */
export default function Survey() {
  const { ready, session, isVerified, refresh } = useAuth();
  const [survey, setSurvey] = useState<SurveyPayload | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ rewarded: number } | null>(null);

  useEffect(() => {
    if (session && isVerified) callFn<SurveyPayload>("studio", { action: "get_survey" }).then(setSurvey).catch((e) => setError(errorMessage(e)));
  }, [session, isVerified]);

  if (!ready) return <div className="container-x py-16"><Spinner /></div>;
  if (!session || !isVerified) return <Navigate to="/signin?next=/survey" replace />;
  if (error && !survey) return <div className="container-x max-w-xl py-16"><Alert>{error}</Alert></div>;
  if (!survey) return <div className="container-x py-16"><Spinner label="Loading questions" /></div>;
  if (!survey.eligible) return <div className="container-x max-w-xl py-16"><Alert tone="info">The survey opens after your first purchase.</Alert></div>;
  if (survey.completed || done) {
    return (
      <div className="container-x max-w-xl py-16 space-y-4">
        <h1 className="text-[44px] leading-tight">Thank you.</h1>
        <p className="text-ink-2">Your answers help us make styles and cards that fit how you actually get your hair cut.
          {done?.rewarded ? ` We've added ${done.rewarded} extra style${done.rewarded > 1 ? "s" : ""} to your account.` : ""}</p>
        <div className="flex gap-2"><Link to="/start" className="btn-primary">Create a new look</Link><Link to="/account" className="btn-secondary">My styles</Link></div>
      </div>
    );
  }

  const q = survey.questions[step];
  const total = survey.questions.length;
  const label = (text: string) => (q.key === "spend_band" && survey.currency ? text.replace(/(\d+)/g, `${SYMBOL[survey.currency] ?? ""}$1`) : text);

  async function choose(value: string) {
    const next = { ...answers, [q.key]: value };
    setAnswers(next);
    if (step < total - 1) { setStep(step + 1); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await callFn<{ rewarded: number }>("studio", { action: "submit_survey", answers: next });
      await refresh();
      setDone(r);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container-x max-w-xl py-12">
      <PageTitle eyebrow={`Question ${step + 1} of ${total}`} title="5 quick questions">
        {survey.rewardGenerations > 0 && step === 0 ? `Tap an answer — takes about 20 seconds. You'll get ${survey.rewardGenerations} extra style as a thank-you.` : undefined}
      </PageTitle>
      <div className="mb-6 h-1 w-full bg-line" aria-hidden="true"><div className="h-1 bg-ink transition-all" style={{ width: `${(step / total) * 100}%` }} /></div>
      <fieldset aria-describedby="survey-note">
        <legend className="font-display text-[30px] leading-tight">{q.prompt}</legend>
        <div className="mt-5 grid gap-2" role="radiogroup" aria-label={q.prompt}>
          {optionsFor(q).map((o) => (
            <button key={o.value} type="button" role="radio" aria-checked={answers[q.key] === o.value} disabled={busy}
              className="chip min-h-14 w-full justify-start text-[16px]" onClick={() => choose(o.value)}>{label(o.label)}</button>
          ))}
        </div>
      </fieldset>
      {busy && <p role="status" className="mt-4 flex items-center gap-2"><Spinner /> Saving…</p>}
      {error && <div className="mt-4"><Alert>{error}</Alert></div>}
      <div className="mt-6 flex justify-between text-[14px]">
        <button className="btn-ghost -ml-3" disabled={step === 0 || busy} onClick={() => setStep(step - 1)}>Back</button>
        <Link to="/account" className="btn-ghost">Skip for now</Link>
      </div>
      <p id="survey-note" className="mt-6 text-[13px] text-muted">Optional. Your answers are linked to your account, used only to improve the service and our recommendations, and deleted if you delete your account. See our <Link to="/privacy" className="underline">Privacy Policy</Link>.</p>
    </div>
  );
}
