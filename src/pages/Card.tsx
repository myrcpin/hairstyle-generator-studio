import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { toPng } from "html-to-image";
import { callFn, errorMessage } from "../lib/api";
import { useAuth } from "../lib/auth";
import { trackClient } from "../lib/analytics";
import type { CardPayload } from "../lib/types";
import { HairstyleCard } from "../components/HairstyleCard";
import { Paywall } from "../components/Paywall";
import { Alert, Spinner } from "../components/ui";
import { VIEW_LABELS } from "../../supabase/functions/_shared/core/constants.ts";

export default function Card() {
  const { id = "" } = useParams();
  const location = useLocation();
  const { allowance, refresh } = useAuth();
  const [card, setCard] = useState<CardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>((location.state as { upgradeBlocked?: string } | null)?.upgradeBlocked ? "You've used this period's full-card builds. Your preview is below; full cards unlock again when your plan renews." : null);
  const [busy, setBusy] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      setCard(await callFn<CardPayload>("studio", { action: "card", cardId: id }));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (card?.status !== "building") return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [card?.status, load]);

  async function action(name: string, fn: () => Promise<void>) {
    setBusy(name);
    setError(null);
    setNotice(null);
    try { await fn(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(null); }
  }

  const upgrade = () => action("upgrade", async () => {
    const r = await callFn<{ upgradeBlocked: string | null }>("studio", { action: "select", generationId: card!.data.views.find((v) => v.view === "front")!.generation_id });
    if (r.upgradeBlocked) setNotice("You've used this period's full-card builds. Full cards unlock again when your plan renews.");
    await Promise.all([load(), refresh()]);
  });

  const downloadCard = () => action("png", async () => {
    if (!ref.current) return;
    const dataUrl = await toPng(ref.current, { pixelRatio: 2, backgroundColor: "#fffdf9", cacheBust: false });
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `hairstyle-card-${card!.data.style_name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`;
    a.click();
    trackClient("download", { kind: "card_png" });
  });

  if (error && !card) return <div className="container-x py-16"><Alert>{error}</Alert><Link to="/account" className="btn-secondary mt-6">My styles</Link></div>;
  if (!card) return <div className="container-x py-16"><Spinner label="Loading your card" /></div>;

  const full = card.tier === "full";
  return (
    <div className="container-x py-8">
      <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link to={`/project/${card.projectId}`} className="btn-ghost -ml-3">← Back to your looks</Link>
        {card.status === "building" && <p role="status" aria-live="polite" className="flex items-center gap-2 text-[14px] text-ink-2"><Spinner /> Creating extra angles for your card…</p>}
      </div>

      {notice && <div className="no-print mb-4"><Alert tone="info">{notice}</Alert></div>}
      {error && <div className="no-print mb-4"><Alert>{error}</Alert></div>}

      <HairstyleCard ref={ref} card={card} qrUrl={card.qr} publicUrl={card.publicUrl} />

      <div className="no-print mx-auto mt-8 max-w-4xl space-y-6">
        {!full && (allowance?.paid ? (
          <div className="border border-ink bg-card p-6">
            <h2 className="text-[28px]">Build your full Hairstyle Card</h2>
            <p className="mt-2 text-ink-2">Adds 3/4, side and back views, downloads, a QR code and email delivery.</p>
            <button className="btn-primary mt-4" onClick={upgrade} disabled={!!busy}>{busy === "upgrade" ? <Spinner /> : "Build full card"}</button>
          </div>
        ) : <Paywall reason="Unlock the full Hairstyle Card" />)}

        {full && (
          <>
            <section className="grid gap-4 border border-line bg-card p-5 sm:grid-cols-2">
              <div>
                <h2 className="text-[26px]">Take it to your stylist</h2>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button className="btn-primary" onClick={downloadCard} disabled={!!busy || card.status === "building"}>{busy === "png" ? <Spinner /> : "Download card"}</button>
                  <button className="btn-secondary" onClick={() => { trackClient("download", { kind: "pdf" }); window.print(); }}>Save as PDF</button>
                  <button className="btn-secondary" disabled={!!busy} onClick={() => action("email", async () => { await callFn("studio", { action: "email_card", cardId: id }); setNotice("Sent! Check your inbox for your Hairstyle Card."); })}>
                    {busy === "email" ? <Spinner /> : "Email it to me"}
                  </button>
                </div>
                <ul className="mt-4 space-y-1 text-[14px]">
                  {Object.entries(card.images).filter(([, v]) => v?.download).map(([view, v]) => (
                    <li key={view}><a className="underline" href={v!.download!} onClick={() => trackClient("download", { kind: view })}>Download {VIEW_LABELS[view as keyof typeof VIEW_LABELS].toLowerCase()} image (high resolution)</a></li>
                  ))}
                </ul>
              </div>
              <div>
                <h2 className="text-[26px]">Share link</h2>
                {card.publicUrl ? (
                  <>
                    <p className="mt-2 break-all text-[14px] text-ink-2">{card.publicUrl}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button className="btn-secondary" onClick={() => action("copy", async () => { await navigator.clipboard.writeText(card.publicUrl!); setNotice("Link copied."); })}>Copy link</button>
                      <button className="btn-ghost" onClick={() => action("revoke", async () => { await callFn("studio", { action: "revoke_card", cardId: id }); await load(); setNotice("Sharing turned off. The old link and QR code no longer work."); })}>Stop sharing</button>
                    </div>
                    <p className="mt-2 text-[12px] text-muted">Anyone with the link can view this card (not your email or account). It expires {new Date(card.expiresAt).toLocaleDateString()}.</p>
                  </>
                ) : (
                  <button className="btn-secondary mt-3" onClick={() => action("share", async () => { await callFn("studio", { action: "share_card", cardId: id }); await load(); })}>Create a new share link</button>
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
