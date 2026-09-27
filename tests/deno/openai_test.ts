// Run: deno test --allow-net --allow-env tests/deno
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";

const received: { path: string; form?: FormData; json?: Record<string, unknown> }[] = [];
let mode: "ok" | "429" | "moderation" | "slow" = "ok";

const server = Deno.serve({ port: 0, onListen: () => {} }, async (req) => {
  const path = new URL(req.url).pathname;
  if (mode === "slow") await new Promise((r) => setTimeout(r, 300));
  if (mode === "429") return Response.json({ error: { code: "rate_limit_exceeded" } }, { status: 429 });
  if (mode === "moderation") return Response.json({ error: { code: "moderation_blocked" } }, { status: 400 });
  if (path === "/v1/images/edits") {
    const form = await req.formData();
    received.push({ path, form });
    return Response.json({ data: [{ b64_json: btoa("fake-jpeg-bytes") }] });
  }
  if (path === "/v1/responses") {
    const json = await req.json();
    received.push({ path, json });
    return Response.json({ output: [{ type: "reasoning" }, { type: "message", content: [{ type: "output_text", text: '{"ok":true}' }] }] });
  }
  return new Response("nope", { status: 404 });
});

Deno.env.set("OPENAI_API_KEY", "test-key");
Deno.env.set("OPENAI_BASE_URL", `http://localhost:${server.addr.port}/v1`);
const { OpenAIImages, OpenAIText } = await import("../../supabase/functions/_shared/ai/openai.ts");
const { ProviderError } = await import("../../supabase/functions/_shared/ai/types.ts");

const img = (name: string) => ({ data: new Uint8Array([0xff, 0xd8, 1, 2, 3]), mime: "image/jpeg", name });

Deno.test("image edit sends identity + reference images as image[] with model/quality/size", async () => {
  mode = "ok";
  const out = await new OpenAIImages().edit({ model: "gpt-image-2.5-flare", prompt: "p", images: [img("person.jpg"), img("reference-1.jpg")], quality: "medium", size: "1024x1536" });
  assertEquals(new TextDecoder().decode(out.data), "fake-jpeg-bytes");
  const form = received.at(-1)!.form!;
  assertEquals(form.get("model"), "gpt-image-2.5-flare");
  assertEquals(form.get("quality"), "medium");
  assertEquals(form.get("size"), "1024x1536");
  assertEquals(form.getAll("image[]").length, 2);
  assertEquals((form.getAll("image[]")[0] as File).name, "person.jpg");
});

Deno.test("structured text call uses json_schema strict and parses output_text", async () => {
  mode = "ok";
  const out = await new OpenAIText().structured<{ ok: boolean }>({ model: "m", system: "s", text: "t", schemaName: "x", schema: { type: "object" }, images: [img("a")] });
  assertEquals(out, { ok: true });
  const body = received.at(-1)!.json!;
  assertEquals((body.text as { format: { strict: boolean } }).format.strict, true);
  assertEquals(body.store, false);
  const content = (body.input as { content: { type: string; image_url?: string }[] }[])[1].content;
  assert(content[1].image_url!.startsWith("data:image/jpeg;base64,"));
});

Deno.test("429 maps to retryable provider_busy; moderation maps to unsafe (not retryable)", async () => {
  mode = "429";
  const e1 = await assertRejects(() => new OpenAIImages().edit({ model: "m", prompt: "p", images: [img("a")], quality: "low", size: "1024x1024" }), ProviderError);
  assertEquals([e1.retryable, e1.code], [true, "provider_busy"]);
  mode = "moderation";
  const e2 = await assertRejects(() => new OpenAIImages().edit({ model: "m", prompt: "p", images: [img("a")], quality: "low", size: "1024x1024" }), ProviderError);
  assertEquals([e2.retryable, e2.code], [false, "unsafe_content"]);
});

Deno.test("timeouts surface as generation_timeout", async () => {
  mode = "slow";
  const e = await assertRejects(() => new OpenAIImages().edit({ model: "m", prompt: "p", images: [img("a")], quality: "low", size: "1024x1024", timeoutMs: 50 }), ProviderError);
  assertEquals(e.code, "generation_timeout");
});

Deno.test({ name: "teardown", fn: async () => { await server.shutdown(); }, sanitizeOps: false, sanitizeResources: false });
