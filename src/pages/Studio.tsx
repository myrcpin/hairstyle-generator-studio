import { useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { callFn, errorMessage } from "../lib/api";
import { supabase } from "../lib/supabase";
import { ImageProblem, prepareImage, type PreparedImage } from "../lib/image";
import { trackClient } from "../lib/analytics";
import { Alert, Spinner } from "../components/ui";
import { isConfigured } from "../lib/config";

type Choice = { value: string; label: string };
const CURRENT: Choice[] = [["very_short", "Very short"], ["short", "Short"], ["medium", "Medium"], ["long", "Long"]].map(([value, label]) => ({ value, label }));
const DESIRED: Choice[] = [["keep_similar", "Keep similar"], ["slightly_shorter", "Slightly shorter"], ["much_shorter", "Much shorter"], ["grow_longer", "Grow longer"], ["not_sure", "Not sure"]].map(([value, label]) => ({ value, label }));
const MAINT: Choice[] = [["very_low", "Very low"], ["low", "Low"], ["moderate", "Moderate"], ["high", "High"]].map(([value, label]) => ({ value, label }));
const DIRECTION: Choice[] = ["professional", "natural", "classic", "modern", "relaxed", "bold"].map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) }));
const COLOUR: Choice[] = [["keep_current", "Keep current"], ["slight_change", "Slight change"], ["new_colour", "New colour"], ["no_preference", "No preference"]].map(([value, label]) => ({ value, label }));

function SingleChoice({ legend, options, value, onChange }: { legend: string; options: Choice[]; value: string | null; onChange: (v: string | null) => void }) {
  return (
    <fieldset>
      <legend className="mb-2 text-[14px] font-medium">{legend} <span className="font-normal text-muted">(optional)</span></legend>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={legend}>
        {options.map((o) => (
          <button type="button" key={o.value} role="radio" aria-checked={value === o.value} className="chip" onClick={() => onChange(value === o.value ? null : o.value)}>{o.label}</button>
        ))}
      </div>
    </fieldset>
  );
}

function PhotoSlot({ label, hint, image, onPick, onClear, required }: { label: string; hint: string; image: PreparedImage | null; onPick: (f: File) => void; onClear: () => void; required?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  return (
    <div>
      <div
        className={`relative flex aspect-[3/4] w-full flex-col items-center justify-center overflow-hidden border border-dashed bg-card text-center transition-colors ${drag ? "border-ink" : "border-line"}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) onPick(f); }}
      >
        {image ? (
          <>
            <img src={image.previewUrl} alt={`${label} preview`} className="h-full w-full object-cover" />
            <button type="button" onClick={onClear} className="absolute right-2 top-2 bg-card/95 px-3 py-1.5 text-[13px]">Remove</button>
          </>
        ) : (
          <button type="button" onClick={() => input.current?.click()} className="flex h-full w-full flex-col items-center justify-center gap-2 p-4">
            <span className="text-[30px] leading-none" aria-hidden="true">+</span>
            <span className="font-medium">{label}{required ? "" : " (optional)"}</span>
            <span className="text-[13px] text-muted">{hint}</span>
          </button>
        )}
      </div>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label={label} onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f); e.target.value = ""; }} />
    </div>
  );
}

export default function Studio() {
  const navigate = useNavigate();
  const { ensureSession, isVerified } = useAuth();
  const [params] = useSearchParams();
  const orgId = params.get("org");
  const [clientLabel, setClientLabel] = useState("");
  const [selfie, setSelfie] = useState<PreparedImage | null>(null);
  const [refs, setRefs] = useState<(PreparedImage | null)[]>([null]);
  const [description, setDescription] = useState("");
  const [currentLength, setCurrentLength] = useState<string | null>(null);
  const [desiredLength, setDesiredLength] = useState<string | null>(null);
  const [maintenance, setMaintenance] = useState<string | null>(null);
  const [styleDirection, setStyleDirection] = useState<string[]>([]);
  const [colour, setColour] = useState<string | null>(null);
  const [consentTerms, setConsentTerms] = useState(false);
  const [consentRights, setConsentRights] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  const refImages = refs.filter((r): r is PreparedImage => !!r);

  async function pick(file: File, set: (i: PreparedImage) => void) {
    setError(null);
    if (!started.current) { started.current = true; trackClient("upload_started"); }
    try {
      set(await prepareImage(file));
    } catch (e) {
      setError(e instanceof ImageProblem ? e.message : "We couldn't read that photo. Please try a different one.");
    }
  }

  async function submit() {
    setError(null);
    if (!selfie) return setError("Please add a photo of yourself first.");
    if (!consentTerms) return setError(orgId ? "Please confirm your client has agreed to their photo being used." : "Please confirm you agree to the terms and to us processing your photo.");
    if (refImages.length && !consentRights) return setError("Please confirm you have permission to use the reference photos.");
    try {
      setStatus("Uploading your photo…");
      await ensureSession();
      const files = [{ type: "selfie", img: selfie }, ...refImages.map((img) => ({ type: "reference", img }))];
      const project = await callFn<{ projectId: string; uploads: { type: string; path: string; token: string }[] }>("studio", {
        action: "create_project",
        consent: orgId ? { clientConsent: true, rights: consentRights } : { terms: true, processing: true, rights: consentRights },
        ...(orgId ? { orgId, clientLabel } : {}),
        files: files.map((f) => ({ type: f.type, contentType: f.img.contentType, size: f.img.blob.size })),
      });
      // Signed upload URLs: the browser never gets general storage access.
      const selfieUploads = project.uploads.filter((u) => u.type === "selfie");
      const refUploads = project.uploads.filter((u) => u.type === "reference");
      const pairs = [[selfieUploads[0], selfie] as const, ...refUploads.map((u, i) => [u, refImages[i]] as const)];
      await Promise.all(pairs.map(async ([u, img]) => {
        const { error: upErr } = await supabase.storage.from("uploads").uploadToSignedUrl(u.path, u.token, img.blob, { contentType: img.contentType });
        if (upErr) throw new Error("upload");
      }));
      setStatus("Analysing your hairstyle preferences…");
      await callFn("studio", {
        action: "analyse", projectId: project.projectId,
        request: { description, currentLength, desiredLength, maintenance, styleDirection, colour },
      }).catch((e) => {
        // Project exists; the project page shows rejection details (e.g. multiple faces) and lets them retry.
        if (e?.status === 422) navigate(`/project/${project.projectId}`, { state: { error: errorMessage(e) } });
        throw e;
      });
      navigate(`/project/${project.projectId}`);
    } catch (e) {
      setStatus(null);
      setError(e instanceof Error && e.message === "upload" ? "Your photo didn't finish uploading. Please try again." : errorMessage(e));
    }
  }

  const busy = status !== null;

  return (
    <div className="container-x max-w-3xl py-10">
      <ol className="mb-8 flex gap-6 text-[13px] uppercase tracking-[0.12em]" aria-label="Progress">
        <li className={step === 1 ? "text-ink" : "text-muted"} aria-current={step === 1 ? "step" : undefined}>1 · Photo</li>
        <li className={step === 2 ? "text-ink" : "text-muted"} aria-current={step === 2 ? "step" : undefined}>2 · Describe</li>
        <li className="text-muted">3 · Your looks</li>
      </ol>

      {!isConfigured && <div className="mb-6"><Alert tone="warn">The backend isn't configured, so uploads are disabled in this build.</Alert></div>}

      {step === 1 && (
        <section aria-labelledby="photo-h">
          {orgId && !isVerified && <div className="mb-4"><Alert tone="warn">Please <Link to={`/signin?next=/start?org=${orgId}`} className="underline">sign in</Link> with your salon account to start a client consultation.</Alert></div>}
          {orgId && <p className="eyebrow mb-2">Client consultation</p>}
          <h1 id="photo-h" className="text-[44px] leading-tight">{orgId ? "Start with a photo of your client." : "Start with a photo of you."}</h1>
          <p className="mt-3 text-ink-2">Best results: front-facing photo, good lighting, face visible, hair visible, no heavy filters.</p>
          <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div className="col-span-2 sm:col-span-1">
              <PhotoSlot label={orgId ? "Client photo" : "Your photo"} hint="JPG, PNG or WebP · up to 10 MB" image={selfie} required onPick={(f) => pick(f, setSelfie)} onClear={() => setSelfie(null)} />
            </div>
            {refs.map((r, i) => (
              <PhotoSlot key={i} label={i === 0 ? "A style you like" : "Another reference"} hint="A hairstyle photo to use as reference" image={r}
                onPick={(f) => pick(f, (img) => setRefs((xs) => { const n = [...xs]; n[i] = img; if (n.length < 3 && n.every(Boolean)) n.push(null); return n; }))}
                onClear={() => setRefs((xs) => { const n = xs.filter((_, j) => j !== i); return n.length && n.every(Boolean) && n.length < 3 ? [...n, null] : n.length ? n : [null]; })} />
            ))}
          </div>
          <p className="mt-4 text-[13px] text-muted">Reference photos are used for the hairstyle only — never the other person's face or identity. We strip location data from your photos before upload.</p>
          {error && <div className="mt-4"><Alert>{error}</Alert></div>}
          <div className="mt-8">
            <button className="btn-primary w-full sm:w-auto" onClick={() => { if (!selfie) { setError("Please add a photo of yourself first."); return; } setError(null); setStep(2); }}>Continue</button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section aria-labelledby="describe-h" className="space-y-7">
          <div>
            <h1 id="describe-h" className="text-[44px] leading-tight">{orgId ? "What is your client looking for?" : "What are you looking for?"}</h1>
            <p className="mt-3 text-ink-2">Describe it in your own words. No hairstyle terms needed — everything below is optional.</p>
          </div>
          <div>
            <label htmlFor="desc" className="sr-only">Describe what you want</label>
            <textarea id="desc" rows={4} maxLength={800} value={description} onChange={(e) => setDescription(e.target.value)} className="input min-h-32 py-3"
              placeholder="I want to cut it shorter but keep enough length for a bun. Professional, natural and easy to maintain." />
            <p className="mt-1 text-right text-[12px] text-muted">{description.length}/800</p>
          </div>
          <SingleChoice legend="Current length" options={CURRENT} value={currentLength} onChange={setCurrentLength} />
          <SingleChoice legend="Desired length" options={DESIRED} value={desiredLength} onChange={setDesiredLength} />
          <SingleChoice legend="Maintenance" options={MAINT} value={maintenance} onChange={setMaintenance} />
          <fieldset>
            <legend className="mb-2 text-[14px] font-medium">Style direction <span className="font-normal text-muted">(optional, pick any)</span></legend>
            <div className="flex flex-wrap gap-2">
              {DIRECTION.map((o) => (
                <button type="button" key={o.value} className="chip" aria-pressed={styleDirection.includes(o.value)}
                  onClick={() => setStyleDirection((xs) => xs.includes(o.value) ? xs.filter((x) => x !== o.value) : [...xs, o.value])}>{o.label}</button>
              ))}
            </div>
          </fieldset>
          <SingleChoice legend="Colour" options={COLOUR} value={colour} onChange={setColour} />

          {orgId && (
            <div>
              <label htmlFor="client-label" className="mb-1 block text-[14px] font-medium">Client name or initials <span className="font-normal text-muted">(optional, for your records)</span></label>
              <input id="client-label" className="input" maxLength={60} value={clientLabel} onChange={(e) => setClientLabel(e.target.value)} />
            </div>
          )}
          <div className="space-y-3 border-t border-line pt-6 text-[15px]">
            {orgId ? (
              <label className="flex items-start gap-3">
                <input type="checkbox" className="mt-1 h-5 w-5 accent-ink" checked={consentTerms} onChange={(e) => setConsentTerms(e.target.checked)} />
                <span>My client has agreed to their photo being used to create hairstyle previews. Photos are deleted automatically after a few days (<Link to="/privacy" className="underline" target="_blank">Privacy Policy</Link>).</span>
              </label>
            ) : (
            <label className="flex items-start gap-3">
              <input type="checkbox" className="mt-1 h-5 w-5 accent-ink" checked={consentTerms} onChange={(e) => setConsentTerms(e.target.checked)} />
              <span>I agree to the <Link to="/terms" className="underline" target="_blank">Terms</Link> and to my photo being processed to create hairstyle images, as described in the <Link to="/privacy" className="underline" target="_blank">Privacy Policy</Link>. I'm 18 or over and this is a photo of me.</span>
            </label>
            )}
            {refImages.length > 0 && (
              <label className="flex items-start gap-3">
                <input type="checkbox" className="mt-1 h-5 w-5 accent-ink" checked={consentRights} onChange={(e) => setConsentRights(e.target.checked)} />
                <span>I have permission to upload the reference photo{refImages.length > 1 ? "s" : ""}, and understand only the hairstyle will be used.</span>
              </label>
            )}
          </div>

          {error && <Alert>{error}</Alert>}
          {status && <p role="status" aria-live="polite" className="flex items-center gap-3 text-ink-2"><Spinner label={status} /> {status}</p>}
          <div className="flex flex-col-reverse gap-3 sm:flex-row">
            <button className="btn-ghost" onClick={() => setStep(1)} disabled={busy}>Back</button>
            <button className="btn-primary sm:ml-auto" onClick={submit} disabled={busy || !isConfigured}>{busy ? "Working…" : "Plan my looks"}</button>
          </div>
        </section>
      )}
    </div>
  );
}
