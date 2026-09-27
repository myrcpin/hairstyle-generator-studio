// Random per-browser id used only for abuse limits (hashed server-side). Not a fingerprint.
const KEY = "cc_device";

function rand(): string {
  const b = new Uint8Array(18);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function deviceId(): string {
  try {
    let v = localStorage.getItem(KEY);
    if (!v) { v = rand(); localStorage.setItem(KEY, v); }
    return v;
  } catch {
    return rand();
  }
}

export function newIdempotencyKey(): string {
  return rand();
}
