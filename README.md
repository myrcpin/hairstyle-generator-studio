# CutCard — see your next haircut before you cut it

A mobile-first web app that turns a selfie plus a plain-English request into three personalised
hairstyle concepts, then into a **Hairstyle Card**: a structured, shareable reference (multi-angle
images, "what to ask for", keep/change, length guide, styling, maintenance, QR code) for a
barber or stylist.

> Working name is `CutCard`. Change it with `VITE_APP_NAME` (frontend) and `APP_NAME` (edge functions).

## Architecture

```
Browser (React + TS + Tailwind, Vite)
  │  anon key only · RLS-protected reads · signed upload URLs
  ▼
Supabase
  ├─ Auth         anonymous sign-in → email OTP (6-digit code) links the email to the same account
  ├─ Postgres     schema + RLS + atomic credit functions   (supabase/migrations)
  ├─ Storage      private buckets: uploads / generations / cards (no public access)
  └─ Edge Functions (Deno)                                 (supabase/functions)
       studio          create_project · analyse · generate · generate_another · alter · select
                       card · email_card · share/revoke · save/delete project · delete account · claim
                       get/submit_survey · get/attach_referral
       billing         PayPal subscriptions (Plus + salon) · Starter Pack buy/capture · confirm · cancel
       business        salons: create · dashboard · branding/logo · staff invites · members
       paypal-webhook  signature-verified, idempotent, re-fetches authoritative subscription state
       public-card     /style/<token> data (no email, no ids)
       admin           stats · settings · plans
       track           whitelisted client analytics events
       maintenance     hourly: retention deletes, stuck-generation recovery + refunds
  ▼
OpenAI (server-side only)      PayPal Subscriptions API      Resend (email)
```

Key design decisions

| Concern | How it's handled |
|---|---|
| Identity preservation | User photo is always image 1 of an **edit** call; prompts list what must not change; reference photos are fenced as "hairstyle only" (`_shared/core/prompts.ts`). |
| Three genuinely different options | Text model returns conservative / balanced / substantial; output validator rejects missing directions or duplicate names (`core/brief.ts`). |
| Honesty about feasibility | Each recommendation carries `achievable_now` / `needs_growth` / `concept_only`, shown as badges; brief carries feasibility warnings. |
| Card accuracy | Images are generated separately; the card is deterministic HTML/CSS (`src/components/HairstyleCard.tsx`). Model text is sanitised and invented cm/inch/clipper measurements are stripped unless the user wrote them. Views that fail are labelled, never faked. |
| Credits never trusted from client | `reserve_usage()` locks the user row, is idempotent per key, consumes subscription → one-time grant → free; `finalize_usage()` refunds on technical failure. Tested against real Postgres. |
| Cost control | Flare for exploration, Sunburst only for alterations and card angles; identical analysis requests reuse cached results; a direction with a live/finished concept is never regenerated; idempotency keys on every generation; retry max 2 for retryable errors only; full-card builds capped per period. |
| Abuse | Verified, non-disposable email before any image generation; hashed-IP + per-user rate limits; max free accounts per hashed IP per 30 days; hashed random device id (no fingerprinting). |
| Privacy | Private buckets + short-lived signed URLs; client strips EXIF/GPS and downscales before upload; source photos auto-deleted (7 days default), generations 30 days unless saved; unverified anonymous users purged after 7 days; project and account deletion; no facial recognition; `store: false` on text-model calls. |
| Provider swap | `_shared/ai/types.ts` defines `TextProvider` / `ImageProvider`; OpenAI is one implementation selected in `_shared/ai/index.ts`. |
| Starter Pack, survey, referrals, salons | One-off pack via PayPal Orders (captured and verified server-side); 5-question post-purchase survey; 3-friend referral → free month (max 3); salon plans with branded cards. See [docs/GROWTH.md](docs/GROWTH.md) and [docs/COMPETITORS.md](docs/COMPETITORS.md). |

## Local development

```bash
npm install
cp .env.example .env.local        # fill VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
npm run dev
```

Without Supabase variables the site still renders (landing, legal, pricing) and shows a
"backend not configured" banner; uploads are disabled.

## Deploying (production)

1. **Supabase project** — create one, then:
   ```bash
   npx supabase link --project-ref <ref>
   npx supabase db push                       # applies supabase/migrations
   npx supabase functions deploy studio billing business paypal-webhook public-card admin track maintenance
   ```
   `paypal-webhook`, `public-card`, `maintenance` and `track` run with `verify_jwt = false`
   (see `supabase/config.toml`); they do their own verification.
2. **Auth settings** (Dashboard → Authentication):
   - Enable **anonymous sign-ins** and **email** provider; turn on CAPTCHA (Turnstile) for anonymous sign-ins in production.
   - Set Site URL / redirect URLs to your domain.
   - Edit the **Magic Link** and **Change Email Address** templates to include the code: `Your code is {{ .Token }}`.
   - Configure custom SMTP (e.g. Resend SMTP) — Supabase's default mailer is rate-limited and not for production.
3. **Secrets** (server-only — never prefix with `VITE_`):
   ```bash
   npx supabase secrets set SITE_URL=https://yourdomain.com ALLOWED_ORIGINS=https://yourdomain.com \
     APP_NAME=CutCard OPENAI_API_KEY=... PAYPAL_ENV=live PAYPAL_CLIENT_ID=... PAYPAL_CLIENT_SECRET=... \
     PAYPAL_WEBHOOK_ID=... RESEND_API_KEY=... EMAIL_FROM="CutCard <cards@yourdomain.com>" \
     IP_HASH_SALT=$(openssl rand -hex 32) CRON_SECRET=$(openssl rand -hex 32)
   ```
4. **PayPal** (sandbox first):
   - The **Starter Pack** needs no PayPal plan (it's a one-off Orders checkout); its price lives in the `plans` table.
   - Create a Product and one monthly Plan **per currency** (GBP and USD) for Plus, and for each salon plan (`business_studio`, `business_pro`). Put the plan ids in
     Admin → Configuration → Plan (or `update plans set prices = ...`). The configured amount is sent to PayPal as a
     plan override, so admin price changes apply to new subscribers.
   - Create a webhook to `https://<ref>.supabase.co/functions/v1/paypal-webhook` subscribed to:
     `BILLING.SUBSCRIPTION.ACTIVATED, .RE-ACTIVATED, .UPDATED, .CANCELLED, .SUSPENDED, .EXPIRED, .PAYMENT.FAILED,
     PAYMENT.SALE.COMPLETED, PAYMENT.SALE.REFUNDED, PAYMENT.SALE.REVERSED, PAYMENT.CAPTURE.COMPLETED` (the last one is for Starter Packs).
     Copy its id into `PAYPAL_WEBHOOK_ID`.
5. **Retention job** — run `supabase/cron.sql` in the SQL editor (fill in project ref and `CRON_SECRET`).
6. **Admin** — `update public.users set is_admin = true where email = 'you@yourdomain.com';`
7. **Frontend** — deploy `dist/` (Vercel/Netlify/Cloudflare Pages) with `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
   `VITE_APP_NAME`, `VITE_SUPPORT_EMAIL`, `VITE_COMPANY_NAME`, `VITE_COMPANY_ADDRESS`. Configure SPA fallback to `index.html`.
8. **Example imagery** — the landing page expects consented, real example photos at
   `public/examples/{before,after,view-front,view-side,view-three-quarter,view-back}.jpg`. Generate them with the
   live pipeline from a model who has signed a release. Until then a neutral frame is shown (never a fake result).

## Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | frontend | Public project URL and anon key (safe to expose; RLS protects data) |
| `VITE_APP_NAME`, `VITE_SUPPORT_EMAIL`, `VITE_COMPANY_NAME`, `VITE_COMPANY_ADDRESS` | frontend | Branding and legal pages |
| `SITE_URL`, `ALLOWED_ORIGINS`, `APP_NAME` | functions | Links in emails/QR, CORS allowlist |
| `OPENAI_API_KEY` | functions | AI calls. Optional overrides: `TEXT_MODEL`, `IMAGE_MODEL_EXPLORE`, `IMAGE_MODEL_FINAL`, `OPENAI_BASE_URL` |
| `PAYPAL_ENV`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID` | functions | Subscriptions + webhook verification |
| `RESEND_API_KEY`, `EMAIL_FROM` | functions | Card emails |
| `IP_HASH_SALT`, `CRON_SECRET` | functions | Abuse hashing salt, maintenance auth |

## Tests

| Command | What it proves |
|---|---|
| `npm test` | 29 unit tests: image sniffing, validation, prompt construction (identity rules, reference fencing, prompt-injection quoting), model-output validation, measurement stripping, PayPal state mapping, tokens, pricing, survey validation, referral codes/progress, pack-capture verification (owner/amount/currency/status) |
| `npm run test:db` | Applies migrations to a throwaway Postgres and asserts: free 3, paid 7 + 2, idempotency, refunds, renewal reset, cancelled-until-period-end, suspended loses access, grants, rate limits, RLS isolation, no client privilege escalation; Starter Pack access, referral 3/3 → month, idempotent qualification, consecutive reward months, max 3 rewards, salon credit pool, salon RLS |
| `npm run test:deno` | OpenAI provider against a mock server: multipart shape, structured outputs, 429/moderation/timeout mapping |
| `npm run check:functions` | `deno check` + `deno lint` on every edge function |
| `npm run test:e2e` | Playwright (mobile, en-GB) runs the real UI through the full journey against a stateful mock of the backend contracts: landing → invalid uploads → upload → plan → email OTP (wrong then right code) → 3 free looks → paywall → preview card → subscribe → full card with angles + QR → PNG download → email → public QR page → alteration → generate another → revoke link → cancel; plus rejected-photo and dead-link cases; referral (3 friends buy packs → referrer rewarded) with the 5-question survey; salon setup → subscribe → client consultation → branded card emailed to client |

**Not yet verified against live services:** real OpenAI output quality/identity preservation, real PayPal
sandbox approval + webhooks, real Supabase Auth email delivery. These need credentials; run the
[launch checklist](docs/LAUNCH.md#pre-launch-verification-with-real-credentials) before going live.
