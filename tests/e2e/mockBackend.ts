// Stateful mock of the backend contracts (Auth, PostgREST, Storage, Edge Functions) for UI E2E tests.
// It mirrors server rules that matter to the UI: free 3 / paid 7+2 allowances, refunds on failure,
// card tiers, share tokens, revocation, subscription lifecycle.
import type { Page, Route } from "@playwright/test";
import { readFileSync } from "node:fs";
import QRCode from "qrcode";

const BASE = "http://127.0.0.1:59999";
const SELFIE = readFileSync(new URL("./fixtures/selfie.jpg", import.meta.url));

type Json = Record<string, unknown>;
interface User { id: string; email: string | null; email_confirmed_at: string | null; is_anonymous: boolean; subscription_status: string; period_end: string | null; is_admin: boolean }
interface Gen { id: string; project_id: string; user_id: string; parent_generation_id: string | null; generation_type: string; direction: string | null; view: string; recommendation: Json | null; instruction: string | null; status: string; error_message: string | null; concept_only: boolean; created_at: string; polls: number; failNext?: boolean }

const rec = (direction: string, name: string, extra: Json = {}) => ({
  direction, name, description: `${name}: a realistic cut planned from your photo.`, why_it_fits: "Keeps enough length to tie back while removing bulk.",
  intended_length: "Around shoulder length", maintenance: "Low", cutting_characteristics: ["Light internal layers"], colour_note: null,
  feasibility: "achievable_now", feasibility_note: null, tied_back_relevant: direction === "substantial", ...extra,
});

export class MockBackend {
  users = new Map<string, User>();
  projects: Json[] = [];
  gens: Gen[] = [];
  cards: Json[] = [];
  usage = new Map<string, { free: number; gen: number; alt: number; card: number }>();
  events: string[] = [];
  emails: { to: string; cardId: string }[] = [];
  seq = 0;

  id(prefix = "") { this.seq++; return `${prefix}00000000-0000-4000-8000-${String(this.seq).padStart(12, "0")}`.slice(-36); }
  now() { return new Date().toISOString(); }

  session(u: User) {
    return {
      access_token: `tok-${u.id}`, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: `ref-${u.id}`,
      user: this.userObj(u),
    };
  }
  userObj(u: User) {
    return { id: u.id, aud: "authenticated", role: "authenticated", email: u.email ?? "", email_confirmed_at: u.email_confirmed_at, is_anonymous: u.is_anonymous, app_metadata: {}, user_metadata: {}, created_at: this.now() };
  }
  userFrom(route: Route): User | null {
    const auth = route.request().headers()["authorization"] ?? "";
    const id = auth.replace("Bearer tok-", "");
    return this.users.get(id) ?? null;
  }
  allowance(u: User) {
    const x = this.usage.get(u.id) ?? { free: 0, gen: 0, alt: 0, card: 0 };
    const paid = u.subscription_status === "active" || (u.subscription_status === "cancelled" && !!u.period_end && new Date(u.period_end) > new Date());
    const sub = { generations: { limit: paid ? 7 : 0, used: x.gen, remaining: paid ? 7 - x.gen : 0 }, alterations: { limit: paid ? 2 : 0, used: x.alt, remaining: paid ? 2 - x.alt : 0 }, card_builds: { limit: paid ? 3 : 0, used: x.card, remaining: paid ? 3 - x.card : 0 } };
    return {
      paid, subscription_status: u.subscription_status, period_end: u.period_end, email_verified: !!u.email_confirmed_at,
      free: { limit: 3, used: x.free, remaining: 3 - x.free }, subscription: sub,
      remaining: { generations: 3 - x.free + sub.generations.remaining, alterations: sub.alterations.remaining, card_builds: sub.card_builds.remaining },
    };
  }
  reserve(u: User, type: "generation" | "alteration" | "card"): string | null {
    const x = this.usage.get(u.id) ?? { free: 0, gen: 0, alt: 0, card: 0 };
    this.usage.set(u.id, x);
    const a = this.allowance(u);
    if (type === "generation") {
      if (a.subscription.generations.remaining > 0) { x.gen++; return "gen"; }
      if (a.free.remaining > 0) { x.free++; return "free"; }
      return null;
    }
    if (type === "alteration") { if (a.subscription.alterations.remaining > 0) { x.alt++; return "alt"; } return null; }
    if (a.subscription.card_builds.remaining > 0) { x.card++; return "card"; }
    return null;
  }
  refund(u: User, src: string) {
    const x = this.usage.get(u.id)!;
    if (src === "gen") x.gen--; else if (src === "free") x.free--; else if (src === "alt") x.alt--; else if (src === "card") x.card--;
  }

  err(route: Route, status: number, code: string, message: string) {
    return route.fulfill({ status, contentType: "application/json", headers: cors, body: JSON.stringify({ error: { code, message } }) });
  }
  ok(route: Route, body: unknown, status = 200) {
    return route.fulfill({ status, contentType: "application/json", headers: cors, body: JSON.stringify(body) });
  }

  newGen(u: User, projectId: string, type: string, direction: string | null, recommendation: Json | null, extra: Partial<Gen> = {}): Gen {
    const g: Gen = { id: this.id(), project_id: projectId, user_id: u.id, parent_generation_id: null, generation_type: type, direction, view: "front", recommendation, instruction: null, status: "queued", error_message: null, concept_only: false, created_at: this.now(), polls: 0, ...extra };
    this.gens.push(g);
    return g;
  }
  /** Generations complete after being observed twice (simulates async processing). */
  tick() {
    for (const g of this.gens) {
      if (g.status === "queued" || g.status === "processing") {
        g.polls++;
        if (g.polls === 1) g.status = "processing";
        else if (g.polls >= 2) g.status = "succeeded";
      }
    }
    for (const c of this.cards) {
      const data = c.card_data as { views: { view: string; generation_id: string | null; status: string }[] };
      for (const v of data.views) {
        const g = this.gens.find((x) => x.id === v.generation_id);
        if (g && v.view !== "front") v.status = g.status === "succeeded" ? "ready" : g.status === "failed" ? "unavailable" : "pending";
      }
      c.status = data.views.some((v) => v.status === "pending") ? "building" : "ready";
    }
  }

  async install(page: Page) {
    await page.route(`${BASE}/**`, (route) => this.handle(route));
  }

  async handle(route: Route) {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const url = new URL(req.url());
    const p = url.pathname;
    const body = (() => { try { return JSON.parse(req.postData() ?? "{}"); } catch { return {}; } })() as Json;

    // ---------- images ----------
    if (p.startsWith("/img/")) return route.fulfill({ status: 200, contentType: "image/jpeg", headers: cors, body: SELFIE });
    if (p.startsWith("/qr/")) {
      const png = await QRCode.toBuffer(`http://localhost:5174/style/${p.slice(4)}`, { width: 256 });
      return route.fulfill({ status: 200, contentType: "image/png", headers: cors, body: png });
    }

    // ---------- auth ----------
    if (p === "/auth/v1/signup") {
      const u: User = { id: this.id(), email: null, email_confirmed_at: null, is_anonymous: true, subscription_status: "none", period_end: null, is_admin: false };
      this.users.set(u.id, u);
      return this.ok(route, this.session(u));
    }
    if (p === "/auth/v1/user" && req.method() === "PUT") {
      const u = this.userFrom(route)!;
      (u as User & { pending_email?: string }).pending_email = String(body.email);
      return this.ok(route, { ...this.userObj(u), new_email: body.email });
    }
    if (p === "/auth/v1/user") { const u = this.userFrom(route); return u ? this.ok(route, this.userObj(u)) : this.err(route, 401, "unauthorized", "no"); }
    if (p === "/auth/v1/otp") return this.ok(route, {});
    if (p === "/auth/v1/verify") {
      if (body.token !== "123456") return this.err(route, 400, "otp_expired", "Token has expired or is invalid");
      // Like GoTrue: email_change resolves the user by their pending address; email resolves by address.
      let u = body.type === "email_change"
        ? [...this.users.values()].find((x) => (x as User & { pending_email?: string }).pending_email === body.email) ?? null
        : null;
      if (!u) {
        u = [...this.users.values()].find((x) => x.email === body.email) ?? null;
        if (!u) { u = { id: this.id(), email: String(body.email), email_confirmed_at: null, is_anonymous: false, subscription_status: "none", period_end: null, is_admin: false }; this.users.set(u.id, u); }
      }
      u.email = String(body.email); u.email_confirmed_at = this.now();
      this.events.push("email_verified");
      return this.ok(route, this.session(u));
    }
    if (p.startsWith("/auth/v1/logout")) return route.fulfill({ status: 204, headers: cors });
    if (p === "/auth/v1/token") return this.err(route, 400, "invalid_grant", "no refresh in mock");

    // ---------- storage (signed upload) ----------
    if (p.startsWith("/storage/v1/object/upload/sign/uploads/")) return this.ok(route, { Key: p.split("/sign/")[1] });

    // ---------- PostgREST ----------
    if (p === "/rest/v1/rpc/public_config") {
      return this.ok(route, { limits: { free_generations: 3, paid_generations: 7, paid_alterations: 2 }, plans: [{ code: "plus_monthly", kind: "subscription", name: "Plus", generations: 7, alterations: 2, card_builds: 3, prices: { GBP: { amount: "2.99" }, USD: { amount: "3.99" } } }] });
    }
    if (p.startsWith("/rest/v1/")) {
      const u = this.userFrom(route);
      this.tick();
      const table = p.slice(9);
      const single = (req.headers()["accept"] ?? "").includes("vnd.pgrst.object");
      let rows: Json[] = [];
      if (u) {
        if (table === "users") rows = [{ id: u.id, email: u.email, email_verified: !!u.email_confirmed_at, subscription_status: u.subscription_status, subscription_plan: u.subscription_status === "none" ? null : "plus_monthly", current_period_start: null, current_period_end: u.period_end, is_admin: u.is_admin, created_at: this.now() }];
        if (table === "projects") rows = this.projects.filter((x) => x.user_id === u.id);
        if (table === "generations") rows = this.gens.filter((x) => x.user_id === u.id) as unknown as Json[];
        if (table === "style_cards") rows = this.cards.filter((x) => x.user_id === u.id);
      }
      for (const [k, v] of url.searchParams) {
        if (["select", "order", "limit"].includes(k)) continue;
        if (v.startsWith("eq.")) rows = rows.filter((r) => String(r[k]) === v.slice(3));
        if (v.startsWith("in.(")) { const set = v.slice(4, -1).split(","); rows = rows.filter((r) => set.includes(String(r[k]))); }
      }
      const clean = rows.map(({ polls: _p, failNext: _f, user_id: _u, ...r }) => ({ ...r, user_id: _u }));
      if (single) return clean.length ? this.ok(route, clean[0]) : this.ok(route, null, 406);
      return this.ok(route, clean);
    }

    // ---------- Edge Functions ----------
    if (p === "/functions/v1/track") { this.events.push(String(body.event)); return this.ok(route, { ok: true }); }
    if (p === "/functions/v1/public-card") {
      const c = this.cards.find((x) => x.public_token === body.token);
      if (!c) return this.err(route, 404, "card_revoked", "This Hairstyle Card is no longer shared.");
      this.events.push("qr_viewed");
      return this.ok(route, this.cardPayload(c, true));
    }
    const u = this.userFrom(route);
    if (!u) return this.err(route, 401, "unauthorized", "Please sign in again to continue.");
    if (p === "/functions/v1/studio") return this.studio(route, u, body);
    if (p === "/functions/v1/billing") return this.billing(route, u, body);
    return this.err(route, 404, "not_found", "not found");
  }

  cardPayload(c: Json, pub = false) {
    this.tick();
    const data = c.card_data as { views: { view: string; generation_id: string | null; status: string }[] };
    const images: Json = {};
    for (const v of data.views) if (v.generation_id) images[v.view] = { url: `${BASE}/img/${v.generation_id}`, download: pub || c.tier !== "full" ? null : `${BASE}/img/${v.generation_id}?download=1` };
    return {
      id: c.id, projectId: c.project_id, tier: c.tier, status: c.status,
      data: { ...(c.card_data as Json), views: pub ? data.views.filter((v) => v.status === "ready") : data.views, disclaimer: "This card is a visual communication aid created with AI image generation." },
      images, original: pub ? null : `${BASE}/img/original`,
      qr: !pub && c.tier === "full" && c.public_token ? `${BASE}/qr/${c.public_token}` : null,
      publicUrl: !pub && c.tier === "full" && c.public_token ? `http://localhost:5174/style/${c.public_token}` : null,
      revoked: !!c.revoked_at, expiresAt: new Date(Date.now() + 90 * 86400_000).toISOString(),
    };
  }

  buildFull(u: User, c: Json) {
    if (!this.reserve(u, "card")) return "insufficient_credits";
    const front = this.gens.find((g) => g.id === c.selected_generation_id)!;
    const views = ["three_quarter", "side", "back", ...((front.recommendation as Json)?.tied_back_relevant ? ["tied_back"] : [])];
    const data = c.card_data as { views: Json[] };
    data.views = [data.views[0], ...views.map((view) => {
      const g = this.newGen(u, String(c.project_id), "card_view", null, front.recommendation, { view, parent_generation_id: front.id });
      return { view, generation_id: g.id, status: "pending" };
    })];
    Object.assign(c, { tier: "full", status: "building", public_token: `tok_${"x".repeat(30)}${this.seq}`, revoked_at: null });
    this.events.push("qr_generated");
    return null;
  }

  async studio(route: Route, u: User, b: Json) {
    const verified = !!u.email_confirmed_at;
    switch (b.action) {
      case "allowance": return this.ok(route, this.allowance(u));
      case "create_project": {
        const id = this.id();
        this.projects.push({ id, user_id: u.id, status: "draft", brief: null, recommendations: null, rejection_reason: null, saved: false, created_at: this.now(), expires_at: new Date(Date.now() + 30 * 86400_000).toISOString() });
        const files = b.files as { type: string }[];
        return this.ok(route, { projectId: id, uploads: files.map((f, i) => ({ imageId: `${id}-${i}`, type: f.type, path: `${u.id}/${id}/${i}.jpg`, token: "t" })) });
      }
      case "analyse": {
        const pr = this.projects.find((x) => x.id === b.projectId)!;
        const desc = String((b.request as Json)?.description ?? "");
        if (desc.includes("TEST_MULTIPLE")) { Object.assign(pr, { status: "rejected", rejection_reason: "multiple_people" }); return this.err(route, 422, "multiple_people", "Your photo seems to include more than one person. Please use a photo with just you in it."); }
        const recs = [rec("conservative", "Refined Long Layers"), rec("balanced", "Soft Shoulder Cut"), rec("substantial", "Collarbone Lob", { feasibility: "needs_growth", feasibility_note: "Needs a little growth at the front." })];
        Object.assign(pr, { status: "ready", recommendations: recs, brief: { requested_change: "Shorter, but long enough for a bun", keep: ["Enough length for a bun"], change: ["Less bulk"], feasibility_warnings: [] } });
        return this.ok(route, { brief: pr.brief, recommendations: recs, cached: false });
      }
      case "urls": {
        const gens = this.gens.filter((g) => g.project_id === b.projectId && g.status === "succeeded");
        return this.ok(route, { sources: [], generations: Object.fromEntries(gens.map((g) => [g.id, `${BASE}/img/${g.id}`])), downloads: {}, expiresIn: 3600 });
      }
      case "generate": case "generate_another": {
        if (!verified) return this.err(route, 403, "email_required", "Please verify your email to generate your free styles.");
        const pr = this.projects.find((x) => x.id === b.projectId)!;
        const recs = pr.recommendations as Json[];
        const created: string[] = [];
        const todo = b.action === "generate"
          ? recs.filter((r) => (!b.directions || (b.directions as string[]).includes(String(r.direction))) && r.direction !== "extra" && !this.gens.some((g) => g.project_id === pr.id && g.direction === r.direction && g.status !== "failed"))
          : [rec("extra", `Textured Crop ${this.seq}`)];
        for (const r of todo) {
          const src = this.reserve(u, "generation");
          if (!src) break;
          created.push(this.newGen(u, String(pr.id), "concept", String(r.direction), r).id);
          if (b.action === "generate_another") pr.recommendations = [...recs, r];
        }
        if (!created.length) { const a = this.allowance(u); return this.err(route, 402, a.paid ? "insufficient_credits" : "paid_feature", "That's part of Plus. Upgrade to unlock it."); }
        pr.status = "generating";
        return this.ok(route, { generationIds: created, created: created.length });
      }
      case "alter": {
        const parent = this.gens.find((g) => g.id === b.generationId)!;
        if (!this.reserve(u, "alteration")) return this.err(route, 402, this.allowance(u).paid ? "insufficient_credits" : "paid_feature", "That's part of Plus. Upgrade to unlock it.");
        const g = this.newGen(u, parent.project_id, "alteration", parent.direction, parent.recommendation, { parent_generation_id: parent.id, instruction: [...(b.presets as string[]), b.instruction].filter(Boolean).join(". ") });
        this.events.push("alteration_requested");
        return this.ok(route, { generationId: g.id });
      }
      case "select": {
        const g = this.gens.find((x) => x.id === b.generationId)!;
        let c = this.cards.find((x) => x.selected_generation_id === g.id);
        if (!c) {
          const r = g.recommendation as Json;
          c = { id: this.id(), project_id: g.project_id, user_id: u.id, selected_generation_id: g.id, tier: "preview", status: "ready", public_token: null, revoked_at: null, created_at: this.now(),
            card_data: { style_name: r.name, description: r.description, feasibility: r.feasibility, feasibility_note: r.feasibility_note, what_to_ask_for: "Keep the overall length around shoulder level. Add light internal layers to reduce bulk.", keep: ["Enough length for a bun"], change: ["Less bulk at the ends"], length_guide: [{ area: "Overall", guidance: "Just above the shoulders" }], styling: ["Air-dry with a little cream"], maintenance: { summary: "Low upkeep.", trim_interval: "Every 8–12 weeks", daily_effort: "5 minutes" }, views: [{ view: "front", generation_id: g.id, status: "ready" }], generated_at: this.now(), prompt_version: "test" } };
          this.cards.push(c);
          this.events.push("hairstyle_selected");
        }
        let upgradeBlocked = null;
        if (c.tier === "preview" && this.allowance(u).paid) upgradeBlocked = this.buildFull(u, c);
        return this.ok(route, { cardId: c.id, upgradeBlocked });
      }
      case "card": { const c = this.cards.find((x) => x.id === b.cardId && x.user_id === u.id); return c ? this.ok(route, this.cardPayload(c)) : this.err(route, 404, "not_found", "We couldn't find that."); }
      case "email_card": {
        if (!this.allowance(u).paid) return this.err(route, 402, "paid_feature", "That's part of Plus.");
        this.emails.push({ to: u.email!, cardId: String(b.cardId) });
        this.events.push("email_share");
        return this.ok(route, { sent: true });
      }
      case "revoke_card": { const c = this.cards.find((x) => x.id === b.cardId)!; Object.assign(c, { public_token: null, revoked_at: this.now() }); return this.ok(route, { revoked: true }); }
      case "share_card": { const c = this.cards.find((x) => x.id === b.cardId)!; Object.assign(c, { public_token: `tok_${"y".repeat(30)}${this.seq++}`, revoked_at: null }); return this.ok(route, {}); }
      case "delete_project": { this.projects = this.projects.filter((x) => x.id !== b.projectId); this.events.push("project_deleted"); return this.ok(route, { deleted: true }); }
      case "save_project": return this.ok(route, { saved: true });
      default: return this.err(route, 400, "invalid_input", "bad action");
    }
  }

  async billing(route: Route, u: User, b: Json) {
    switch (b.action) {
      case "create_subscription":
        if (!u.email_confirmed_at) return this.err(route, 403, "email_required", "Please verify your email.");
        u.subscription_status = "pending";
        this.events.push("checkout_started");
        // Simulates PayPal approval redirecting back to our return URL.
        return this.ok(route, { approveUrl: "http://localhost:5174/billing/return?subscription_id=I-TESTSUB&ba_token=BA-1", subscriptionId: "I-TESTSUB" });
      case "confirm":
        if (b.subscriptionId !== "I-TESTSUB") return this.err(route, 403, "forbidden", "You don't have access to that.");
        u.subscription_status = "active"; u.period_end = new Date(Date.now() + 30 * 86400_000).toISOString();
        this.events.push("subscription_completed");
        return this.ok(route, { status: "active", allowance: this.allowance(u) });
      case "cancel":
        u.subscription_status = "cancelled";
        this.events.push("subscription_cancelled");
        return this.ok(route, { allowance: this.allowance(u) });
      case "status": return this.ok(route, this.allowance(u));
      default: return this.err(route, 400, "invalid_input", "bad");
    }
  }
}

const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*", "access-control-expose-headers": "*" };
