import { useEffect, useState } from "react";
import { callFn, errorMessage } from "../lib/api";
import { usePublicConfig } from "../lib/publicConfig";
import { Alert, Spinner } from "./ui";

interface Referral { code: string; link: string; joined: number; qualified: number; rewards: number; maxRewards: number; perReward: number; inCycle: number; capped: boolean }

/** "Share with 3 friends — when 3 buy a Starter Pack you get a free month" (up to 3 times). */
export function ReferralPanel() {
  const { pack, referrals } = usePublicConfig();
  const [r, setR] = useState<Referral | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => { callFn<Referral>("studio", { action: "get_referral" }).then(setR).catch((e) => setError(errorMessage(e))); }, []);

  async function share() {
    if (!r) return;
    const text = `I used this to preview my next haircut and get a card to show my barber. Try 3 styles free:`;
    if (navigator.share) {
      try { await navigator.share({ title: "See your next haircut before you cut it", text, url: r.link }); return; } catch { /* cancelled */ }
    }
    await navigator.clipboard.writeText(r.link);
    setCopied(true);
  }

  if (error) return <Alert>{error}</Alert>;
  if (!r) return <Spinner label="Loading your invite link" />;

  return (
    <section aria-labelledby="ref-h" className="border border-line bg-card p-5">
      <p className="eyebrow">Invite friends</p>
      <h2 id="ref-h" className="mt-1 text-[28px] leading-tight">3 friends buy a {pack.name} → you get a free month of Plus</h2>
      <p className="mt-2 text-[15px] text-ink-2">
        Earn it up to {r.maxRewards} times.{referrals.referee_bonus_generations > 0 ? ` Your friends get ${referrals.referee_bonus_generations} bonus style with their pack.` : ""}
      </p>
      <div className="mt-4" aria-label={`${r.inCycle} of ${r.perReward} friends towards your next free month`}>
        <div className="flex gap-2" aria-hidden="true">
          {Array.from({ length: r.perReward }, (_, i) => (
            <span key={i} className={`h-2 flex-1 ${i < r.inCycle ? "bg-ink" : "bg-line"}`} />
          ))}
        </div>
        <p className="mt-2 text-[14px] text-ink-2">
          {r.capped ? `You've earned all ${r.maxRewards} free months — thank you!` : `${r.inCycle}/${r.perReward} friends towards your next free month`}
          {" · "}{r.rewards}/{r.maxRewards} months earned · {r.joined} joined with your link
        </p>
      </div>
      {!r.capped && (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
          <input readOnly value={r.link} aria-label="Your invite link" className="input min-h-10 flex-1 text-[14px]" onFocus={(e) => e.currentTarget.select()} />
          <button className="btn-primary min-h-10" onClick={share}>{copied ? "Link copied" : "Share link"}</button>
        </div>
      )}
      <p className="mt-3 text-[12px] text-muted">A friend counts once they create a new account with your link and buy a {pack.name}. We never show you who bought.</p>
    </section>
  );
}
