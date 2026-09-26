import { admin } from "./db.ts";

export type Bucket = "uploads" | "generations" | "cards";

export async function download(bucket: Bucket, path: string): Promise<Uint8Array | null> {
  const { data, error } = await admin().storage.from(bucket).download(path);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

export async function upload(bucket: Bucket, path: string, data: Uint8Array, contentType: string) {
  const { error } = await admin().storage.from(bucket).upload(path, new Blob([data as Uint8Array<ArrayBuffer>], { type: contentType }), { contentType, upsert: true });
  if (error) throw new Error(`storage upload failed: ${error.message}`);
}

export async function signedUrls(bucket: Bucket, paths: string[], expiresIn = 3600, download?: string | boolean): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const uniq = [...new Set(paths.filter(Boolean))];
  if (!uniq.length) return out;
  if (download) {
    await Promise.all(uniq.map(async (p) => {
      const { data } = await admin().storage.from(bucket).createSignedUrl(p, expiresIn, { download });
      if (data?.signedUrl) out[p] = data.signedUrl;
    }));
    return out;
  }
  const { data } = await admin().storage.from(bucket).createSignedUrls(uniq, expiresIn);
  for (const row of data ?? []) if (row.path && row.signedUrl) out[row.path] = row.signedUrl;
  return out;
}

export async function remove(bucket: Bucket, paths: string[]) {
  const list = paths.filter(Boolean);
  for (let i = 0; i < list.length; i += 100) {
    const { error } = await admin().storage.from(bucket).remove(list.slice(i, i + 100));
    if (error) console.error("storage remove failed", bucket, error.message);
  }
}

/** Removes every object under a prefix (e.g. "<user>/<project>"). */
export async function removePrefix(bucket: Bucket, prefix: string) {
  const { data } = await admin().storage.from(bucket).list(prefix, { limit: 1000 });
  await remove(bucket, (data ?? []).map((o) => `${prefix}/${o.name}`));
}
