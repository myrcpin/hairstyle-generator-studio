import { supabase } from "./supabase";
import { SUPABASE_ANON_KEY, SUPABASE_URL, isConfigured } from "./config";
import { deviceId } from "./device";
import { messageFor } from "../../supabase/functions/_shared/core/errors.ts";

export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
  }
}

/** Calls an Edge Function with the user's session. Errors are always human-readable. */
export async function callFn<T = unknown>(fn: string, body: Record<string, unknown>, opts: { auth?: boolean } = {}): Promise<T> {
  if (!isConfigured) throw new ApiError("service_unavailable", messageFor("service_unavailable"), 503);
  const { data: { session } } = await supabase.auth.getSession();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: SUPABASE_ANON_KEY!,
    "x-device-id": deviceId(),
  };
  if (opts.auth !== false) headers.Authorization = `Bearer ${session?.access_token ?? SUPABASE_ANON_KEY}`;
  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, { method: "POST", headers, body: JSON.stringify(body) });
  } catch {
    throw new ApiError("network", "We couldn't reach the server. Check your connection and try again.", 0);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = json?.error?.code ?? (res.status === 401 ? "unauthorized" : "server_error");
    throw new ApiError(code, json?.error?.message ?? messageFor(code), res.status);
  }
  return json as T;
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return messageFor("server_error");
}
