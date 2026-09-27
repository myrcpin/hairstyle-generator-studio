import { useEffect, useId, useRef, type ReactNode } from "react";

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2">
      <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function Alert({ tone = "bad", children }: { tone?: "bad" | "ok" | "info" | "warn"; children: ReactNode }) {
  const cls = { bad: "border-bad text-bad", ok: "border-ok text-ok", info: "border-line text-ink-2", warn: "border-warn text-warn" }[tone];
  return (
    <div role={tone === "bad" ? "alert" : "status"} className={`border-l-2 bg-card px-4 py-3 text-[15px] ${cls}`}>
      {children}
    </div>
  );
}

/** Accessible modal built on <dialog> (focus trap + Esc handled by the browser). */
export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby={titleId}
      className="m-auto w-[min(560px,calc(100vw-24px))] max-h-[90dvh] border border-line bg-card p-0 text-ink backdrop:bg-ink/40"
    >
      <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
        <h2 id={titleId} className="text-[28px] leading-tight">{title}</h2>
        <button onClick={onClose} className="btn-ghost -mr-2 min-h-10" aria-label="Close">✕</button>
      </div>
      <div className="px-5 py-5">{children}</div>
    </dialog>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "warn" | "ok" }) {
  const cls = { neutral: "border-line text-ink-2", warn: "border-warn/40 text-warn bg-warn/5", ok: "border-ok/40 text-ok bg-ok/5" }[tone];
  return <span className={`inline-flex items-center border px-2 py-0.5 text-[12px] font-medium ${cls}`}>{children}</span>;
}

export function PageTitle({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: ReactNode }) {
  return (
    <div className="mb-8 space-y-3">
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h1 className="text-[40px] leading-[1.05] sm:text-[52px]">{title}</h1>
      {children && <div className="max-w-2xl text-[17px] text-ink-2">{children}</div>}
    </div>
  );
}
