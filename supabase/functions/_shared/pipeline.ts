// Generation runner: claim -> call provider -> store -> finalize credits. Safe to call more than once.
import { admin } from "./db.ts";
import { download, upload } from "./storage.ts";
import { imageProvider, type InputImage, ProviderError } from "./ai/index.ts";
import { getSettings } from "./settings.ts";
import { messageFor } from "./core/errors.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

export const MAX_ATTEMPTS = 2;
const PROVIDER_TIMEOUT_MS = 110_000;

/** Runs work after the response is sent (Supabase Edge Runtime), or inline elsewhere. */
export function background(p: Promise<unknown>) {
  const guarded = p.catch((e) => console.error("background task failed", e instanceof Error ? e.message : e));
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(guarded);
  else void guarded;
}

interface GenRow {
  id: string; project_id: string; user_id: string; parent_generation_id: string | null;
  generation_type: "concept" | "alteration" | "card_view"; view: string; prompt: string; model: string;
  quality: string; size: string; status: string; attempts: number; usage_id: string | null;
}

async function loadInputs(gen: GenRow): Promise<InputImage[] | null> {
  const db = admin();
  const { data: sources } = await db.from("source_images").select("id,storage_path,type,content_type,uploaded")
    .eq("project_id", gen.project_id).eq("uploaded", true).order("created_at");
  const selfie = (sources ?? []).find((s) => s.type === "selfie");
  if (!selfie) return null;
  const selfieBytes = await download("uploads", selfie.storage_path);
  if (!selfieBytes) return null;
  const selfieImg: InputImage = { data: selfieBytes, mime: selfie.content_type, name: "person.jpg" };

  if (gen.generation_type === "concept") {
    const refs: InputImage[] = [];
    for (const r of (sources ?? []).filter((s) => s.type === "reference")) {
      const b = await download("uploads", r.storage_path);
      if (b) refs.push({ data: b, mime: r.content_type, name: `reference-${refs.length + 1}.jpg` });
    }
    return [selfieImg, ...refs];
  }
  // alteration + card_view: edit the parent generation, keep the original as identity reference
  if (!gen.parent_generation_id) return null;
  const { data: parent } = await db.from("generations").select("storage_path").eq("id", gen.parent_generation_id).single();
  if (!parent?.storage_path) return null;
  const parentBytes = await download("generations", parent.storage_path);
  if (!parentBytes) return null;
  return [{ data: parentBytes, mime: "image/jpeg", name: "style.jpg" }, selfieImg];
}

export async function processGeneration(id: string): Promise<void> {
  const db = admin();
  const { data: row } = await db.from("generations").select("*").eq("id", id).single();
  const gen = row as GenRow | null;
  if (!gen || gen.status !== "queued") return;

  // Claim atomically: only one worker moves queued -> processing.
  const { data: claimed } = await db.from("generations")
    .update({ status: "processing", started_at: new Date().toISOString(), attempts: gen.attempts + 1 })
    .eq("id", id).eq("status", "queued").select("id");
  if (!claimed?.length) return;

  const settings = await getSettings();
  let errorCode: string | null = null;
  let path: string | null = null;

  const inputs = await loadInputs(gen);
  if (!inputs) {
    errorCode = "expired";
  } else {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const result = await imageProvider().edit({
          model: gen.model, prompt: gen.prompt, images: inputs, quality: gen.quality, size: gen.size, timeoutMs: PROVIDER_TIMEOUT_MS,
        });
        path = `${gen.user_id}/${gen.project_id}/${gen.id}.jpg`;
        await upload("generations", path, result.data, result.mime);
        errorCode = null;
        break;
      } catch (e) {
        const pe = e instanceof ProviderError ? e : new ProviderError("server", (e as Error)?.message ?? "unknown");
        errorCode = pe.code;
        if (!pe.retryable || attempt === MAX_ATTEMPTS) break;
        await new Promise((r) => setTimeout(r, pe.kind === "rate_limited" ? 4000 : 1500));
      }
    }
  }

  const ok = !errorCode && !!path;
  await db.from("generations").update({
    status: ok ? "succeeded" : "failed",
    storage_path: path,
    error_code: errorCode,
    error_message: errorCode ? messageFor(errorCode) : null,
    completed_at: new Date().toISOString(),
    cost_estimate_usd: ok ? settings.cost_estimates_usd.image[gen.quality] ?? null : null,
  }).eq("id", id);

  // Credit accounting: technical failures never consume allowance.
  if (gen.usage_id) await db.rpc("finalize_usage", { p_usage: gen.usage_id, p_success: ok });

  if (gen.generation_type === "card_view") await refreshCard(gen.parent_generation_id!);
  else await refreshProjectStatus(gen.project_id);
}

export async function refreshProjectStatus(projectId: string) {
  const db = admin();
  const { count } = await db.from("generations").select("id", { count: "exact", head: true })
    .eq("project_id", projectId).in("status", ["queued", "processing"]).neq("generation_type", "card_view");
  if (!count) await db.from("projects").update({ status: "complete" }).eq("id", projectId).eq("status", "generating");
}

/** Recomputes a card's view list and status from its generations. Consumes/refunds the card build credit once done. */
export async function refreshCard(selectedGenerationId: string) {
  const db = admin();
  const { data: card } = await db.from("style_cards").select("id,card_data,status,tier,build_usage_id").eq("selected_generation_id", selectedGenerationId).single();
  if (!card) return;
  const { data: views } = await db.from("generations").select("id,view,status")
    .eq("parent_generation_id", selectedGenerationId).eq("generation_type", "card_view");
  const data = card.card_data as { views: { view: string; generation_id: string | null; status: string }[] };
  const byView = new Map((views ?? []).map((v) => [v.view, v]));
  data.views = data.views.map((v) => {
    if (v.view === "front") return v;
    const g = byView.get(v.view);
    if (!g) return v;
    return { view: v.view, generation_id: g.id, status: g.status === "succeeded" ? "ready" : g.status === "failed" ? "unavailable" : "pending" };
  });
  const pending = data.views.some((v) => v.status === "pending");
  const anyExtra = data.views.some((v) => v.view !== "front" && v.status === "ready");
  await db.from("style_cards").update({ card_data: data, status: pending ? "building" : "ready" }).eq("id", card.id);
  if (!pending && card.build_usage_id) {
    await db.rpc("finalize_usage", { p_usage: card.build_usage_id, p_success: anyExtra });
  }
}
