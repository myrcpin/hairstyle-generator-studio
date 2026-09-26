import { admin, type AuthedUser, getAllowance } from "../_shared/db.ts";
import { HttpError, json } from "../_shared/http.ts";
import { daysFromNow, getSettings } from "../_shared/settings.ts";
import { deviceHash, ipHash, rateLimit } from "../_shared/ratelimit.ts";
import { download, remove, removePrefix, signedUrls } from "../_shared/storage.ts";
import { textProvider, ProviderError } from "../_shared/ai/index.ts";
import { track } from "../_shared/analytics.ts";
import { ACCEPTED_IMAGE_TYPES } from "../_shared/core/constants.ts";
import { checkImage } from "../_shared/core/image.ts";
import { describeRequest, parseStyleRequest, requestKey } from "../_shared/core/request.ts";
import { ANALYSIS_SYSTEM_PROMPT } from "../_shared/core/prompts.ts";
import { ANALYSIS_JSON_SCHEMA, InvalidModelOutput, sanitizeAnalysis, type Analysis } from "../_shared/core/brief.ts";
import { ownedProject } from "./common.ts";

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export async function createProject(req: Request, user: AuthedUser, body: Record<string, unknown>) {
  const s = await getSettings();
  const ip = await ipHash(req);
  await rateLimit(`create:${ip}`, 3600, s.rate_limits.create_project_per_ip_hour);

  const consent = (body.consent ?? {}) as Record<string, unknown>;
  if (consent.terms !== true || consent.processing !== true) throw new HttpError(400, "consent_required");

  const files = Array.isArray(body.files) ? body.files as Record<string, unknown>[] : [];
  const selfies = files.filter((f) => f.type === "selfie");
  const refs = files.filter((f) => f.type === "reference");
  if (selfies.length !== 1 || refs.length > s.limits.max_reference_images || selfies.length + refs.length !== files.length) {
    throw new HttpError(400, "invalid_input");
  }
  if (refs.length && consent.rights !== true) throw new HttpError(400, "consent_required");
  for (const f of files) {
    if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(String(f.contentType))) throw new HttpError(400, "unsupported_type");
    if (typeof f.size !== "number" || f.size <= 0 || f.size > s.limits.max_upload_mb * 1024 * 1024) throw new HttpError(400, "too_large");
  }

  const db = admin();
  const dev = await deviceHash(req);
  await db.from("users").update({ first_ip_hash: ip }).eq("id", user.id).is("first_ip_hash", null);
  if (dev) await db.from("users").update({ device_hash: dev }).eq("id", user.id).is("device_hash", null);

  const { data: project, error } = await db.from("projects").insert({
    user_id: user.id, ip_hash: ip, expires_at: daysFromNow(s.retention.generation_days),
  }).select("id").single();
  if (error || !project) throw new HttpError(500, "server_error");

  const uploads = [];
  for (const f of files) {
    const id = crypto.randomUUID();
    const path = `${user.id}/${project.id}/${id}.${EXT[String(f.contentType)]}`;
    await db.from("source_images").insert({
      id, project_id: project.id, storage_path: path, type: f.type, content_type: f.contentType,
      rights_confirmed: f.type === "reference" ? consent.rights === true : true,
      expires_at: daysFromNow(s.retention.source_image_days),
    });
    const { data: signed, error: e2 } = await db.storage.from("uploads").createSignedUploadUrl(path);
    if (e2 || !signed) throw new HttpError(500, "server_error");
    uploads.push({ imageId: id, type: f.type, path, token: signed.token });
  }
  await track("upload_started", user.id, project.id, { references: refs.length });
  return json(req, { projectId: project.id, uploads });
}

async function verifyUploads(projectId: string, minPx: number, maxBytes: number) {
  const db = admin();
  const { data: images } = await db.from("source_images").select("*").eq("project_id", projectId).order("created_at");
  if (!images?.length) throw new HttpError(400, "upload_missing");
  const loaded: { id: string; type: string; mime: string; data: Uint8Array }[] = [];
  for (const img of images) {
    const bytes = await download("uploads", img.storage_path);
    if (!bytes) throw new HttpError(400, "upload_missing");
    const check = checkImage(bytes, { maxBytes, minPx });
    if (!check.ok) {
      // Remove anything that isn't a valid image right away.
      await remove("uploads", [img.storage_path]);
      await db.from("source_images").delete().eq("id", img.id);
      throw new HttpError(422, check.problem, { imageType: img.type });
    }
    if (!img.uploaded) {
      await db.from("source_images").update({ uploaded: true, width: check.info.width, height: check.info.height, content_type: check.info.type }).eq("id", img.id);
    }
    loaded.push({ id: img.id, type: img.type, mime: check.info.type, data: bytes });
  }
  if (!loaded.some((i) => i.type === "selfie")) throw new HttpError(400, "upload_missing");
  return loaded;
}

export async function analyse(req: Request, user: AuthedUser, body: Record<string, unknown>) {
  const s = await getSettings();
  const project = await ownedProject(user, body.projectId);
  const ip = await ipHash(req);
  await rateLimit(`analyse:${ip}`, 3600, s.rate_limits.analyse_per_ip_hour);

  const images = await verifyUploads(project.id, s.limits.min_image_px, s.limits.max_upload_mb * 1024 * 1024);
  const request = parseStyleRequest(body.request);
  const hash = requestKey(request, images.map((i) => i.id));
  const db = admin();

  // Cost control: identical request on the same photos -> reuse the existing analysis.
  const { data: last } = await db.from("style_requests").select("id,request_hash").eq("project_id", project.id)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (last?.request_hash === hash && project.recommendations && project.status !== "rejected") {
    return json(req, { styleRequestId: last.id, brief: project.brief, recommendations: project.recommendations, cached: true });
  }

  const reference = images.find((i) => i.type === "reference");
  const { data: sr } = await db.from("style_requests").insert({
    project_id: project.id,
    description: request.description,
    current_length: request.currentLength,
    preferred_length: request.desiredLength,
    maintenance_level: request.maintenance,
    professional_level: request.styleDirection,
    colour_preference: request.colour,
    reference_image_id: reference?.id ?? null,
    request_hash: hash,
  }).select("id").single();

  await db.from("projects").update({ status: "analysing" }).eq("id", project.id);
  await track("upload_completed", user.id, project.id);

  const refCount = images.filter((i) => i.type === "reference").length;
  const text = `${describeRequest(request)}\n\nImages attached: image 1 = client photo${refCount ? `; images 2${refCount > 1 ? `–${refCount + 1}` : ""} = hairstyle reference photo(s)` : "; no reference photos"}.`;
  let analysis: Analysis | null = null;
  for (let attempt = 0; attempt < 2 && !analysis; attempt++) {
    try {
      const raw = await textProvider().structured({
        model: s.models.text, system: ANALYSIS_SYSTEM_PROMPT, text, schemaName: "style_analysis",
        schema: ANALYSIS_JSON_SCHEMA as unknown as Record<string, unknown>,
        images: images.map((i, n) => ({ data: i.data, mime: i.mime, name: `image-${n + 1}` })),
      });
      analysis = sanitizeAnalysis(raw);
    } catch (e) {
      const retry = e instanceof InvalidModelOutput || (e instanceof ProviderError && e.retryable);
      if (!retry || attempt === 1) {
        await db.from("projects").update({ status: "draft" }).eq("id", project.id);
        throw new HttpError(e instanceof ProviderError && e.kind === "unsafe" ? 422 : 502, e instanceof ProviderError ? e.code : "generation_failed");
      }
    }
  }

  if (!analysis!.photo_check.suitable) {
    await db.from("projects").update({ status: "rejected", rejection_reason: analysis!.photo_check.issue, brief: null, recommendations: null }).eq("id", project.id);
    throw new HttpError(422, analysis!.photo_check.issue as "unsuitable_image");
  }

  await db.from("projects").update({
    status: "ready", brief: analysis!.brief, recommendations: analysis!.recommendations, rejection_reason: null,
  }).eq("id", project.id);
  return json(req, { styleRequestId: sr?.id, brief: analysis!.brief, recommendations: analysis!.recommendations, cached: false });
}

export async function projectUrls(req: Request, user: AuthedUser, body: Record<string, unknown>) {
  const project = await ownedProject(user, body.projectId);
  const db = admin();
  const allowance = await getAllowance(user.id);
  const [{ data: sources }, { data: gens }] = await Promise.all([
    db.from("source_images").select("id,type,storage_path").eq("project_id", project.id).eq("uploaded", true),
    db.from("generations").select("id,storage_path").eq("project_id", project.id).eq("status", "succeeded"),
  ]);
  const srcUrls = await signedUrls("uploads", (sources ?? []).map((x) => x.storage_path));
  const genUrls = await signedUrls("generations", (gens ?? []).map((x) => x.storage_path!));
  const downloads: Record<string, string> = {};
  if (allowance.paid) {
    const d = await signedUrls("generations", (gens ?? []).map((x) => x.storage_path!), 3600, true);
    for (const g of gens ?? []) if (d[g.storage_path!]) downloads[g.id] = d[g.storage_path!];
  }
  return json(req, {
    sources: (sources ?? []).map((x) => ({ id: x.id, type: x.type, url: srcUrls[x.storage_path] ?? null })),
    generations: Object.fromEntries((gens ?? []).map((g) => [g.id, genUrls[g.storage_path!] ?? null])),
    downloads,
    expiresIn: 3600,
  });
}

export async function saveProject(req: Request, user: AuthedUser, body: Record<string, unknown>) {
  const project = await ownedProject(user, body.projectId);
  const allowance = await getAllowance(user.id);
  if (!allowance.paid) throw new HttpError(402, "paid_feature");
  const s = await getSettings();
  const saved = body.saved !== false;
  const expires = daysFromNow(saved ? s.retention.saved_project_days : s.retention.generation_days);
  const db = admin();
  await db.from("projects").update({ saved, expires_at: expires }).eq("id", project.id);
  await db.from("generations").update({ expires_at: expires }).eq("project_id", project.id);
  await db.from("style_cards").update({ expires_at: expires }).eq("project_id", project.id);
  return json(req, { saved, expiresAt: expires });
}

export async function deleteProjectData(userId: string, projectId: string) {
  const db = admin();
  // Paths come from the database (projects can move between accounts), plus a prefix sweep for safety.
  const [{ data: srcs }, { data: gens }, { data: cards }] = await Promise.all([
    db.from("source_images").select("storage_path").eq("project_id", projectId),
    db.from("generations").select("storage_path").eq("project_id", projectId).not("storage_path", "is", null),
    db.from("style_cards").select("qr_code_path").eq("project_id", projectId).not("qr_code_path", "is", null),
  ]);
  await Promise.all([
    remove("uploads", (srcs ?? []).map((x) => x.storage_path)),
    remove("generations", (gens ?? []).map((x) => x.storage_path!)),
    remove("cards", (cards ?? []).map((x) => x.qr_code_path!)),
  ]);
  const prefix = `${userId}/${projectId}`;
  await Promise.all([removePrefix("uploads", prefix), removePrefix("generations", prefix), removePrefix("cards", prefix)]);
  await db.from("projects").delete().eq("id", projectId);
}

export async function deleteProject(req: Request, user: AuthedUser, body: Record<string, unknown>) {
  const { data } = await admin().from("projects").select("id,user_id").eq("id", String(body.projectId)).maybeSingle();
  if (!data || data.user_id !== user.id) throw new HttpError(404, "not_found");
  await deleteProjectData(user.id, data.id);
  await track("project_deleted", user.id, null);
  return json(req, { deleted: true });
}
