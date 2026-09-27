import type { Generation, Recommendation } from "../lib/types";
import { APP_NAME } from "../lib/config";
import { Badge, Spinner } from "./ui";

const DIRECTION_LABEL: Record<string, string> = { conservative: "Subtle", balanced: "Balanced", substantial: "Bolder change", extra: "Another idea" };

export function ConceptCard({
  gen, rec, url, watermark, onChoose, onAlter, onAnother, onRetry, busy,
}: {
  gen: Generation | null; rec: Recommendation; url?: string | null; watermark: boolean;
  onChoose?: () => void; onAlter?: () => void; onAnother?: () => void; onRetry?: () => void; busy?: boolean;
}) {
  const status = gen?.status ?? "queued";
  const title = gen?.generation_type === "alteration" ? `${rec.name} — adjusted` : rec.name;
  return (
    <article className="flex w-[82vw] max-w-[380px] shrink-0 snap-center flex-col border border-line bg-card sm:w-auto sm:max-w-none" aria-busy={status === "queued" || status === "processing"}>
      <div className="relative aspect-[2/3] bg-paper-2">
        {status === "succeeded" && url ? (
          <>
            <img src={url} alt={`You with the ${rec.name} hairstyle (AI-generated concept)`} className="h-full w-full object-cover" />
            {watermark && (
              <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <span className="rotate-[-24deg] font-display text-[30px] text-white/55 [text-shadow:0_1px_6px_rgba(0,0,0,.25)]">{APP_NAME} preview</span>
              </div>
            )}
          </>
        ) : status === "failed" || status === "cancelled" ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="text-[15px] text-ink-2">{gen?.error_message ?? "We couldn't create this look."}</p>
            {onRetry && <button className="btn-secondary min-h-10" onClick={onRetry} disabled={busy}>Try again</button>}
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-muted">
            <Spinner label={`Creating ${rec.name}`} />
            <p className="text-[14px]">{status === "processing" ? "Creating this look…" : "Waiting to start…"}</p>
          </div>
        )}
        <span className="absolute left-3 top-3 bg-card/90 px-2 py-1 text-[11px] font-medium uppercase tracking-[0.12em]">{DIRECTION_LABEL[rec.direction] ?? rec.direction}</span>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          <h3 className="text-[28px] leading-tight">{title}</h3>
          {gen?.instruction && <p className="text-[13px] text-muted">Change: {gen.instruction}</p>}
          <p className="mt-1 text-[15px] text-ink-2">{rec.description}</p>
        </div>
        <dl className="grid grid-cols-2 gap-3 text-[14px]">
          <div><dt className="eyebrow">Length</dt><dd>{rec.intended_length || "—"}</dd></div>
          <div><dt className="eyebrow">Maintenance</dt><dd>{rec.maintenance || "—"}</dd></div>
        </dl>
        {rec.why_it_fits && <p className="text-[14px] text-ink-2"><span className="font-medium text-ink">Why it may suit you: </span>{rec.why_it_fits}</p>}
        {rec.feasibility !== "achievable_now" && (
          <div><Badge tone="warn">{rec.feasibility === "needs_growth" ? "Needs growth first" : "Visual concept — not immediately achievable"}</Badge></div>
        )}
        <div className="mt-auto flex flex-wrap gap-2 pt-2">
          <button className="btn-primary flex-1" disabled={status !== "succeeded" || busy} onClick={onChoose}>Choose this</button>
          <button className="btn-secondary flex-1" disabled={status !== "succeeded" || busy} onClick={onAlter}>Alter this</button>
          {onAnother && <button className="btn-ghost w-full text-[14px]" disabled={busy} onClick={onAnother}>Generate another like this</button>}
        </div>
      </div>
    </article>
  );
}
