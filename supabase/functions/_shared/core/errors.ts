// Stable error codes -> human-readable messages. Never surface provider errors verbatim.
export const ERROR_MESSAGES = {
  unauthorized: "Please sign in again to continue.",
  forbidden: "You don't have access to that.",
  not_found: "We couldn't find that. It may have expired or been deleted.",
  expired: "This project has expired and its photos were deleted for your privacy. Start a new one any time.",
  invalid_input: "Something in that request wasn't right. Please check and try again.",
  consent_required: "Please confirm you agree to the terms and have permission to upload these photos.",
  unsupported_type: "That file type isn't supported. Please use a JPG, PNG or WebP photo.",
  too_large: "That photo is too large. Please use one under 10 MB.",
  too_small: "That photo is too small for good results. Please use one at least 512 pixels on the shortest side.",
  unreadable: "We couldn't read that photo. Please try a different one.",
  upload_missing: "Your photo didn't finish uploading. Please try again.",
  no_person: "We couldn't find a person in your photo. Please use a clear photo of yourself.",
  multiple_people: "Your photo seems to include more than one person. Please use a photo with just you in it.",
  face_not_visible: "Your face isn't clearly visible. A front-facing photo with good lighting works best.",
  hair_not_visible: "Your hair isn't clearly visible (for example, it's covered). Please use a photo where your hair can be seen.",
  unsuitable_image: "That photo isn't suitable for a hairstyle preview. Please use a clear, front-facing photo of yourself.",
  unsafe_content: "We can't process that image. Please use a different photo.",
  email_required: "Please verify your email to generate your free styles.",
  disposable_email: "Please use a permanent email address — temporary inboxes aren't supported.",
  insufficient_credits: "You've used all the styles included in your plan for now.",
  paid_feature: "That's part of Plus. Upgrade to unlock it.",
  rate_limited: "You're going a little fast. Please wait a moment and try again.",
  abuse_limit: "We've reached the limit of free previews from this network. Please upgrade or try again later.",
  generation_failed: "We couldn't create this look. You haven't been charged for it — please try again.",
  generation_timeout: "This look took too long to create. You haven't been charged for it — please try again.",
  provider_busy: "Our image service is busy right now. You haven't been charged — please try again in a minute.",
  payment_failed: "Your payment didn't go through. You haven't been charged.",
  payment_pending: "We're waiting for PayPal to confirm your payment. This usually takes a few seconds.",
  card_revoked: "This Hairstyle Card is no longer shared.",
  card_expired: "This Hairstyle Card link has expired.",
  service_unavailable: "This feature isn't configured yet. Please try again later.",
  server_error: "Something went wrong on our side. Please try again.",
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES;

export function messageFor(code: string | null | undefined): string {
  return (code && (ERROR_MESSAGES as Record<string, string>)[code]) || ERROR_MESSAGES.server_error;
}
