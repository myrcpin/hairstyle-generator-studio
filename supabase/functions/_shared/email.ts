// Transactional email via Resend (https://resend.com). Swap by re-implementing sendEmail.
import { requireEnv } from "./http.ts";

export interface EmailAttachment { filename: string; content: string /* base64 */; content_id?: string; content_type?: string }

export async function sendEmail(to: string, subject: string, html: string, text: string, attachments: EmailAttachment[] = []) {
  const key = requireEnv("RESEND_API_KEY");
  const from = requireEnv("EMAIL_FROM");
  const res = await fetch(`${Deno.env.get("RESEND_API_BASE") ?? "https://api.resend.com"}/emails`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, html, text, attachments }),
  });
  if (!res.ok) {
    console.error("email send failed", res.status);
    throw new Error("email_failed");
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
