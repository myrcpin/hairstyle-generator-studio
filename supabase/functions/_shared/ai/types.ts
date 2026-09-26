// Provider-neutral AI interfaces. Swap providers by implementing these two interfaces.

export interface InputImage {
  data: Uint8Array;
  mime: string;
  name: string;
}

export interface StructuredRequest {
  model: string;
  system: string;
  text: string;
  images?: InputImage[];
  schemaName: string;
  schema: Record<string, unknown>;
  timeoutMs?: number;
}

export interface ImageEditRequest {
  model: string;
  prompt: string;
  images: InputImage[];   // images[0] is always the primary image to edit
  quality: string;
  size: string;
  timeoutMs?: number;
}

export interface ImageResult {
  data: Uint8Array;
  mime: string;
}

export interface TextProvider {
  structured<T = unknown>(req: StructuredRequest): Promise<T>;
}

export interface ImageProvider {
  edit(req: ImageEditRequest): Promise<ImageResult>;
}

export type ProviderErrorKind = "rate_limited" | "timeout" | "unsafe" | "bad_request" | "server" | "config";

export class ProviderError extends Error {
  constructor(public kind: ProviderErrorKind, message: string) {
    super(message);
  }
  get retryable() {
    return this.kind === "rate_limited" || this.kind === "timeout" || this.kind === "server";
  }
  /** Maps to a user-facing error code. */
  get code() {
    switch (this.kind) {
      case "rate_limited": return "provider_busy" as const;
      case "timeout": return "generation_timeout" as const;
      case "unsafe": return "unsafe_content" as const;
      case "config": return "service_unavailable" as const;
      default: return "generation_failed" as const;
    }
  }
}
