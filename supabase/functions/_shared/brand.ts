import { admin } from "./db.ts";
import { signedUrls } from "./storage.ts";
import type { CardData } from "./core/card.ts";

/** Salon branding stored on the card (name + booking link); the logo is signed per view. */
export async function brandFor(orgId: string | null): Promise<CardData["brand"]> {
  if (!orgId) return null;
  const { data } = await admin().from("organizations").select("id,name,booking_url").eq("id", orgId).maybeSingle();
  return data ? { org_id: data.id, name: data.name, booking_url: data.booking_url } : null;
}

export async function brandLogoUrl(brand: CardData["brand"], expiresIn = 3600): Promise<string | null> {
  if (!brand?.org_id) return null;
  const { data } = await admin().from("organizations").select("logo_path").eq("id", brand.org_id).maybeSingle();
  if (!data?.logo_path) return null;
  return (await signedUrls("brand", [data.logo_path], expiresIn))[data.logo_path] ?? null;
}

