import { OpenAIImages, OpenAIText } from "./openai.ts";
import type { ImageProvider, TextProvider } from "./types.ts";

// Add providers here; select with AI_TEXT_PROVIDER / AI_IMAGE_PROVIDER.
export function textProvider(): TextProvider {
  switch (Deno.env.get("AI_TEXT_PROVIDER") ?? "openai") {
    default: return new OpenAIText();
  }
}

export function imageProvider(): ImageProvider {
  switch (Deno.env.get("AI_IMAGE_PROVIDER") ?? "openai") {
    default: return new OpenAIImages();
  }
}

export * from "./types.ts";
