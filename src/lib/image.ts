// Client-side photo preparation: validate, fix orientation, downscale, strip metadata (incl. GPS).
import { ACCEPTED_IMAGE_TYPES } from "../../supabase/functions/_shared/core/constants.ts";
import { messageFor } from "../../supabase/functions/_shared/core/errors.ts";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MIN_PX = 512;
const MAX_EDGE = 2048;

export interface PreparedImage {
  blob: Blob;
  contentType: "image/jpeg";
  width: number;
  height: number;
  previewUrl: string;
}

export class ImageProblem extends Error {}

export async function prepareImage(file: File): Promise<PreparedImage> {
  if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type)) throw new ImageProblem(messageFor("unsupported_type"));
  if (file.size > MAX_UPLOAD_BYTES) throw new ImageProblem(messageFor("too_large"));
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new ImageProblem(messageFor("unreadable"));
  }
  if (Math.min(bitmap.width, bitmap.height) < MIN_PX) {
    bitmap.close();
    throw new ImageProblem(messageFor("too_small"));
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ImageProblem(messageFor("unreadable"));
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.92));
  if (!blob) throw new ImageProblem(messageFor("unreadable"));
  return { blob, contentType: "image/jpeg", width, height, previewUrl: URL.createObjectURL(blob) };
}
