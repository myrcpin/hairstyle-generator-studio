import { forwardRef } from "react";
import type { CardPayload, CardView } from "../lib/types";
import { VIEW_LABELS } from "../../supabase/functions/_shared/core/constants.ts";
import { APP_NAME } from "../lib/config";
import { Badge } from "./ui";

const FEASIBILITY: Record<string, { label: string; tone: "ok" | "warn" }> = {
  achievable_now: { label: "Achievable with a haircut", tone: "ok" },
  needs_growth: { label: "Needs some growth first", tone: "warn" },
  concept_only: { label: "Visual concept", tone: "warn" },
};

function ViewTile({ view, status, url, large = false, watermark }: { view: CardView; status: string; url?: string | null; large?: boolean; watermark: boolean }) {
  const label = VIEW_LABELS[view];
  return (
    <figure className="relative flex flex-col">
      <div className={`relative overflow-hidden bg-paper-2 ${large ? "aspect-[2/3]" : "aspect-[2/3]"}`}>
        {status === "ready" && url ? (
          <img src={url} alt={`${label} of the chosen hairstyle`} className="h-full w-full object-cover" crossOrigin="anonymous" />
        ) : status === "pending" ? (
          <div className="flex h-full items-center justify-center p-3 text-center text-[13px] text-muted" role="status">
            <span><span aria-hidden="true" className="mx-auto mb-2 block h-5 w-5 animate-spin rounded-full border-2 border-muted border-r-transparent" />Creating {label.toLowerCase()}…</span>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center p-3 text-center text-[13px] text-muted">
            This angle couldn't be generated reliably, so we've left it out rather than guess.
          </div>
        )}
        {watermark && status === "ready" && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="rotate-[-24deg] font-display text-[34px] text-white/55 [text-shadow:0_1px_6px_rgba(0,0,0,.25)]">{APP_NAME} preview</span>
          </div>
        )}
      </div>
      <figcaption className="mt-1.5 text-[12px] uppercase tracking-[0.12em] text-muted">{label}</figcaption>
    </figure>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line pt-4">
      <h3 className="mb-2 font-sans text-[12px] font-semibold uppercase tracking-[0.14em] text-ink">{title}</h3>
      {children}
    </section>
  );
}

export const HairstyleCard = forwardRef<HTMLDivElement, { card: CardPayload; qrUrl?: string | null; publicUrl?: string | null }>(
  function HairstyleCard({ card, qrUrl, publicUrl }, ref) {
    const d = card.data;
    const watermark = card.tier === "preview";
    const front = d.views.find((v) => v.view === "front");
    const others = d.views.filter((v) => v.view !== "front");
    const feas = FEASIBILITY[d.feasibility] ?? FEASIBILITY.achievable_now;
    return (
      <article ref={ref} className="print-card mx-auto max-w-4xl border border-line bg-card p-4 shadow-[0_1px_0_rgba(0,0,0,.03)] sm:p-8" aria-label={`Hairstyle Card: ${d.style_name}`}>
        <header className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="eyebrow">{APP_NAME} · Hairstyle Card</p>
            <h2 className="mt-1 text-[38px] leading-[1.02] sm:text-[52px]">{d.style_name}</h2>
            <p className="mt-2 max-w-xl text-[15px] text-ink-2">{d.description}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge tone={feas.tone}>{feas.label}</Badge>
              {watermark && <Badge>Preview</Badge>}
            </div>
            {d.feasibility_note && <p className="mt-2 text-[13px] text-warn">{d.feasibility_note}</p>}
          </div>
          {card.original && (
            <figure className="shrink-0 text-center">
              <img src={card.original} alt="Original photo" className="h-20 w-16 object-cover sm:h-28 sm:w-22" crossOrigin="anonymous" />
              <figcaption className="mt-1 text-[11px] uppercase tracking-[0.12em] text-muted">Before</figcaption>
            </figure>
          )}
        </header>

        <div className="mt-6 grid gap-3 sm:grid-cols-[1.35fr_1fr]">
          {front && <ViewTile view="front" status={front.status} url={card.images.front?.url} large watermark={watermark} />}
          {others.length > 0 && (
            <div className="grid grid-cols-2 gap-3 self-start">
              {others.map((v) => <ViewTile key={v.view} view={v.view} status={v.status} url={card.images[v.view]?.url} watermark={watermark} />)}
            </div>
          )}
        </div>

        <div className="mt-8 grid gap-6">
          <Section title="What to ask for">
            <p className="font-display text-[22px] leading-snug sm:text-[26px]">“{d.what_to_ask_for}”</p>
          </Section>
          <div className="grid gap-6 sm:grid-cols-2">
            <Section title="Keep">
              {d.keep.length ? <ul className="list-disc space-y-1 pl-5 text-[15px]">{d.keep.map((k) => <li key={k}>{k}</li>)}</ul> : <p className="text-[15px] text-muted">Nothing specific.</p>}
            </Section>
            <Section title="Change">
              {d.change.length ? <ul className="list-disc space-y-1 pl-5 text-[15px]">{d.change.map((k) => <li key={k}>{k}</li>)}</ul> : <p className="text-[15px] text-muted">—</p>}
            </Section>
          </div>
          {d.length_guide.length > 0 && (
            <Section title="Length guide">
              <dl className="grid gap-x-6 gap-y-2 text-[15px] sm:grid-cols-[max-content_1fr]">
                {d.length_guide.map((l) => (
                  <div key={l.area} className="contents">
                    <dt className="font-medium capitalize">{l.area}</dt>
                    <dd className="text-ink-2">{l.guidance}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2 text-[12px] text-muted">Approximate, relative guidance read from the image — not exact measurements.</p>
            </Section>
          )}
          <div className="grid gap-6 sm:grid-cols-2">
            {d.styling.length > 0 && (
              <Section title="Styling">
                <ul className="list-disc space-y-1 pl-5 text-[15px]">{d.styling.map((k) => <li key={k}>{k}</li>)}</ul>
              </Section>
            )}
            <Section title="Maintenance">
              <p className="text-[15px]">{d.maintenance.summary}</p>
              <dl className="mt-2 space-y-1 text-[14px] text-ink-2">
                {d.maintenance.trim_interval && <div><dt className="inline font-medium text-ink">Trims: </dt><dd className="inline">{d.maintenance.trim_interval}</dd></div>}
                {d.maintenance.daily_effort && <div><dt className="inline font-medium text-ink">Daily styling: </dt><dd className="inline">{d.maintenance.daily_effort}</dd></div>}
              </dl>
            </Section>
          </div>
        </div>

        <footer className="mt-8 flex flex-col gap-4 border-t border-line pt-4 sm:flex-row sm:items-end sm:justify-between">
          <p className="max-w-xl text-[12px] leading-relaxed text-muted">{d.disclaimer}</p>
          {qrUrl && publicUrl && (
            <div className="flex items-center gap-3">
              <img src={qrUrl} alt="QR code that opens this Hairstyle Card" width={96} height={96} className="h-24 w-24" crossOrigin="anonymous" />
              <p className="max-w-[10rem] text-[12px] text-muted">Scan to open this card on your stylist's phone.</p>
            </div>
          )}
        </footer>
      </article>
    );
  },
);
