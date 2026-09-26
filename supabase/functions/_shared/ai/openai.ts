import { type ImageEditRequest, type ImageProvider, type ImageResult, ProviderError, type StructuredRequest, type TextProvider } from "./types.ts";

const BASE = Deno.env.get("OPENAI_BASE_URL") ?? "https://api.openai.com/v1";

function key(): string {
  const k = Deno.env.get("OPENAI_API_KEY");
  if (!k) throw new ProviderError("config", "OPENAI_API_KEY not set");
  return k;
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function call(path: string, init: RequestInit, timeoutMs: number): Promise<Record<string, unknown>> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { ...init, signal: ctrl.signal, headers: { Authorization: `Bearer ${key()}`, ...(init.headers ?? {}) } });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new ProviderError("timeout", "request timed out");
    throw new ProviderError("server", `network: ${(e as Error).message}`);
  } finally {
    clearTimeout(t);
  }
  const body = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (!res.ok) {
    const err = (body.error ?? {}) as Record<string, unknown>;
    const code = String(err.code ?? err.type ?? "");
    // Log only status and code — never prompts, images or keys.
    console.error(`openai ${path} ${res.status} ${code}`);
    if (res.status === 429) throw new ProviderError("rate_limited", code);
    if (res.status >= 500) throw new ProviderError("server", code);
    if (code.includes("moderation") || code.includes("safety") || code === "content_policy_violation") throw new ProviderError("unsafe", code);
    if (res.status === 401 || res.status === 403 || res.status === 404) throw new ProviderError("config", code);
    throw new ProviderError("bad_request", code);
  }
  return body;
}

export class OpenAIText implements TextProvider {
  async structured<T>(req: StructuredRequest): Promise<T> {
    const content: Record<string, unknown>[] = [{ type: "input_text", text: req.text }];
    for (const img of req.images ?? []) {
      content.push({ type: "input_image", image_url: `data:${img.mime};base64,${toBase64(img.data)}`, detail: "low" });
    }
    const body = await call("/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: req.model,
        input: [
          { role: "system", content: [{ type: "input_text", text: req.system }] },
          { role: "user", content },
        ],
        text: { format: { type: "json_schema", name: req.schemaName, schema: req.schema, strict: true } },
        store: false,
      }),
    }, req.timeoutMs ?? 60_000);

    const output = (body.output ?? []) as Record<string, unknown>[];
    for (const item of output) {
      if (item.type !== "message") continue;
      for (const c of (item.content ?? []) as Record<string, unknown>[]) {
        if (c.type === "refusal") throw new ProviderError("unsafe", "refusal");
        if (c.type === "output_text" && typeof c.text === "string") {
          try {
            return JSON.parse(c.text) as T;
          } catch {
            throw new ProviderError("server", "invalid json from model");
          }
        }
      }
    }
    throw new ProviderError("server", "no output");
  }
}

export class OpenAIImages implements ImageProvider {
  async edit(req: ImageEditRequest): Promise<ImageResult> {
    const form = new FormData();
    form.append("model", req.model);
    form.append("prompt", req.prompt);
    form.append("n", "1");
    form.append("size", req.size);
    form.append("quality", req.quality);
    form.append("output_format", "jpeg");
    form.append("output_compression", "90");
    for (const img of req.images) {
      form.append("image[]", new Blob([img.data as Uint8Array<ArrayBuffer>], { type: img.mime }), img.name);
    }
    const body = await call("/images/edits", { method: "POST", body: form }, req.timeoutMs ?? 120_000);
    const b64 = ((body.data ?? []) as Record<string, unknown>[])[0]?.b64_json;
    if (typeof b64 !== "string") throw new ProviderError("server", "no image returned");
    return { data: fromBase64(b64), mime: "image/jpeg" };
  }
}
