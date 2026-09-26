// Reads image type and dimensions from file headers (no decoding, no deps).
import type { AcceptedImageType } from "./constants.ts";

export interface ImageInfo {
  type: AcceptedImageType;
  width: number;
  height: number;
}

function u16be(b: Uint8Array, o: number) { return (b[o] << 8) | b[o + 1]; }
function u32be(b: Uint8Array, o: number) { return ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3]; }
function u16le(b: Uint8Array, o: number) { return b[o] | (b[o + 1] << 8); }
function u24le(b: Uint8Array, o: number) { return b[o] | (b[o + 1] << 8) | (b[o + 2] << 16); }

export function sniffImage(bytes: Uint8Array): ImageInfo | null {
  if (bytes.length < 32) return null;
  // PNG
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { type: "image/png", width: u32be(bytes, 16), height: u32be(bytes, 20) };
  }
  // JPEG: walk segments to the SOFn marker
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let o = 2;
    while (o + 9 < bytes.length) {
      if (bytes[o] !== 0xff) { o++; continue; }
      const marker = bytes[o + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { o += 2; continue; }
      const len = u16be(bytes, o + 2);
      const isSOF = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSOF) return { type: "image/jpeg", height: u16be(bytes, o + 5), width: u16be(bytes, o + 7) };
      o += 2 + len;
    }
    return null;
  }
  // WebP (RIFF....WEBP)
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    const chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
    if (chunk === "VP8 ") return { type: "image/webp", width: u16le(bytes, 26) & 0x3fff, height: u16le(bytes, 28) & 0x3fff };
    if (chunk === "VP8L") {
      const b = bytes;
      const width = 1 + (((b[22] & 0x3f) << 8) | b[21]);
      const height = 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6));
      return { type: "image/webp", width, height };
    }
    if (chunk === "VP8X") return { type: "image/webp", width: 1 + u24le(bytes, 24), height: 1 + u24le(bytes, 27) };
    return null;
  }
  return null;
}

export interface ImageRules { maxBytes: number; minPx: number; }

export type ImageProblem = "unsupported_type" | "too_large" | "too_small" | "unreadable";

export function checkImage(bytes: Uint8Array, rules: ImageRules): { ok: true; info: ImageInfo } | { ok: false; problem: ImageProblem } {
  if (bytes.length > rules.maxBytes) return { ok: false, problem: "too_large" };
  const info = sniffImage(bytes);
  if (!info) return { ok: false, problem: "unsupported_type" };
  if (!info.width || !info.height) return { ok: false, problem: "unreadable" };
  if (Math.min(info.width, info.height) < rules.minPx) return { ok: false, problem: "too_small" };
  return { ok: true, info };
}
