// Business (salon) package: organisations, staff seats, branding, client sessions.
import { HttpError, isUuid, json, readJson, requireEnv, serve } from "../_shared/http.ts";
import { admin, type AuthedUser, requireUser } from "../_shared/db.ts";
import { track } from "../_shared/analytics.ts";
import { rateLimit } from "../_shared/ratelimit.ts";
import { download, remove, signedUrls } from "../_shared/storage.ts";
import { checkImage } from "../_shared/core/image.ts";
import { isValidEmail, normaliseEmail } from "../_shared/core/email.ts";
import { randomToken } from "../_shared/core/tokens.ts";

const db = () => admin();

async function membership(userId: string, orgId: unknown) {
  if (!isUuid(orgId)) throw new HttpError(400, "invalid_input");
  const { data } = await db().from("organization_members").select("role").eq("org_id", orgId).eq("user_id", userId).maybeSingle();
  if (!data) throw new HttpError(403, "org_required");
  return data.role as "owner" | "stylist";
}

async function requireOwner(userId: string, orgId: unknown) {
  if ((await membership(userId, orgId)) !== "owner") throw new HttpError(403, "forbidden");
}

function requireVerified(user: AuthedUser) {
  if (!user.email || !user.emailVerified) throw new HttpError(403, "email_required");
}

function cleanBookingUrl(v: unknown): string | null {
  if (v === null || v === "" || v === undefined) return null;
  if (typeof v !== "string" || v.length > 300) throw new HttpError(400, "invalid_input");
  try {
    const u = new URL(v);
    if (u.protocol !== "https:") throw new Error();
    return u.toString();
  } catch {
    throw new HttpError(400, "invalid_input");
  }
}

serve(async (req) => {
  if (req.method !== "POST") throw new HttpError(405, "invalid_input");
  const body = await readJson(req);
  const user = await requireUser(req);

  switch (body.action) {
    case "my_orgs": {
      const { data } = await db().from("organization_members").select("role, organizations(id,name,slug,subscription_status,plan_code)").eq("user_id", user.id);
      return json(req, { orgs: (data ?? []).map((m) => ({ role: m.role, ...(m.organizations as unknown as Record<string, unknown>) })) });
    }

    case "create_org": {
      requireVerified(user);
      await rateLimit(`org-create:${user.id}`, 86400, 3);
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const slug = typeof body.slug === "string" ? body.slug.trim().toLowerCase() : "";
      if (name.length < 2 || name.length > 80 || !/^[a-z0-9-]{3,40}$/.test(slug)) throw new HttpError(400, "invalid_input");
      const { data: org, error } = await db().from("organizations").insert({
        name, slug, booking_url: cleanBookingUrl(body.bookingUrl), contact_email: user.email, created_by: user.id,
      }).select("id").single();
      if (error) throw new HttpError(409, error.code === "23505" ? "slug_taken" : "invalid_input");
      await db().from("organization_members").insert({ org_id: org.id, user_id: user.id, role: "owner" });
      await track("business_created", user.id, null);
      return json(req, { orgId: org.id });
    }

    case "get_org": {
      const role = await membership(user.id, body.orgId);
      const [{ data: org }, { data: allowance }, { data: members }, { data: sessions }] = await Promise.all([
        db().from("organizations").select("id,name,slug,booking_url,logo_path,contact_email,plan_code,subscription_status,current_period_end").eq("id", body.orgId).single(),
        db().rpc("get_org_allowance", { p_org: body.orgId }),
        db().from("organization_members").select("user_id,role,created_at,users(email)").eq("org_id", body.orgId).order("created_at"),
        db().from("projects").select("id,client_label,status,created_at,user_id,style_cards(id,tier)").eq("org_id", body.orgId)
          .order("created_at", { ascending: false }).limit(50),
      ]);
      const logo = org?.logo_path ? (await signedUrls("brand", [org.logo_path]))[org.logo_path] ?? null : null;
      return json(req, {
        role, org: { ...org, logo_url: logo }, allowance,
        // staff emails are only shown to owners
        members: (members ?? []).map((m) => ({ userId: m.user_id, role: m.role, email: role === "owner" ? (m.users as unknown as { email: string })?.email : null, you: m.user_id === user.id })),
        sessions: (sessions ?? []).map((p) => ({
          id: p.id, clientLabel: p.client_label, status: p.status, createdAt: p.created_at,
          cardId: (p.style_cards as unknown as { id: string }[])?.[0]?.id ?? null,
        })),
      });
    }

    case "update_org": {
      await requireOwner(user.id, body.orgId);
      const patch: Record<string, unknown> = {};
      if (typeof body.name === "string") {
        const n = body.name.trim();
        if (n.length < 2 || n.length > 80) throw new HttpError(400, "invalid_input");
        patch.name = n;
      }
      if (body.bookingUrl !== undefined) patch.booking_url = cleanBookingUrl(body.bookingUrl);
      if (body.contactEmail !== undefined) {
        const e = normaliseEmail(String(body.contactEmail));
        if (!isValidEmail(e)) throw new HttpError(400, "invalid_input");
        patch.contact_email = e;
      }
      await db().from("organizations").update(patch).eq("id", body.orgId);
      return json(req, { ok: true });
    }

    case "logo_upload": {
      await requireOwner(user.id, body.orgId);
      const type = String(body.contentType);
      if (!["image/png", "image/jpeg", "image/webp"].includes(type) || typeof body.size !== "number" || body.size > 1_000_000) throw new HttpError(400, "unsupported_type");
      const path = `${body.orgId}/logo-${randomToken(8)}.${type.split("/")[1]}`;
      const { data, error } = await db().storage.from("brand").createSignedUploadUrl(path);
      if (error || !data) throw new HttpError(500, "server_error");
      return json(req, { path, token: data.token });
    }

    case "logo_confirm": {
      await requireOwner(user.id, body.orgId);
      const path = String(body.path);
      if (!path.startsWith(`${body.orgId}/logo-`)) throw new HttpError(400, "invalid_input");
      const bytes = await download("brand", path);
      const check = bytes ? checkImage(bytes, { maxBytes: 1_000_000, minPx: 64 }) : null;
      if (!check?.ok) {
        await remove("brand", [path]);
        throw new HttpError(422, check && !check.ok ? check.problem : "upload_missing");
      }
      const { data: old } = await db().from("organizations").select("logo_path").eq("id", body.orgId).single();
      await db().from("organizations").update({ logo_path: path }).eq("id", body.orgId);
      if (old?.logo_path && old.logo_path !== path) await remove("brand", [old.logo_path]);
      return json(req, { ok: true });
    }

    case "create_invite": {
      await requireOwner(user.id, body.orgId);
      const { data: a } = await db().rpc("get_org_allowance", { p_org: body.orgId });
      const allowance = a as { members: number; max_members: number };
      if (allowance.members >= allowance.max_members) throw new HttpError(409, "org_seats_full");
      const code = randomToken(18);
      await db().from("organization_invites").insert({ code, org_id: body.orgId, role: body.role === "owner" ? "owner" : "stylist", created_by: user.id });
      const site = requireEnv("SITE_URL").replace(/\/$/, "");
      return json(req, { link: `${site}/business/join/${code}`, expiresInDays: 7 });
    }

    case "join": {
      requireVerified(user);
      const code = String(body.code ?? "");
      const { data: inv } = await db().from("organization_invites").select("*").eq("code", code).maybeSingle();
      if (!inv || inv.used_at || new Date(inv.expires_at) < new Date()) throw new HttpError(410, "invite_invalid");
      const { data: a } = await db().rpc("get_org_allowance", { p_org: inv.org_id });
      const allowance = a as { members: number; max_members: number };
      const { data: already } = await db().from("organization_members").select("user_id").eq("org_id", inv.org_id).eq("user_id", user.id).maybeSingle();
      if (!already) {
        if (allowance.members >= allowance.max_members) throw new HttpError(409, "org_seats_full");
        await db().from("organization_members").insert({ org_id: inv.org_id, user_id: user.id, role: inv.role });
      }
      await db().from("organization_invites").update({ used_by: user.id, used_at: new Date().toISOString() }).eq("code", code).is("used_at", null);
      return json(req, { orgId: inv.org_id });
    }

    case "remove_member": {
      await requireOwner(user.id, body.orgId);
      if (!isUuid(body.userId)) throw new HttpError(400, "invalid_input");
      const { data: owners } = await db().from("organization_members").select("user_id").eq("org_id", body.orgId).eq("role", "owner");
      if ((owners ?? []).length === 1 && owners![0].user_id === body.userId) throw new HttpError(400, "invalid_input");
      await db().from("organization_members").delete().eq("org_id", body.orgId).eq("user_id", body.userId);
      return json(req, { ok: true });
    }

    default:
      throw new HttpError(400, "invalid_input");
  }
});
