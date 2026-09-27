# Review, launch, promotion and scaling plan

## 1. Challenges to the brief (and what I did about them)

| Brief says | Concern | Decision in this build |
|---|---|---|
| "Require email before generation or after the first result" | Every image costs money; giving the first result before email invites scripted abuse of anonymous sessions. | Upload + analysis are anonymous; the user sees their **three planned directions by name** (value, cheap text call) and verifies email with a 6-digit code **before any image is generated**. The code keeps them in the same tab on mobile. Measure drop-off at `email_submitted` → `email_verified`; if it's bad, A/B "first image before email" behind Turnstile. |
| 3 free generations | The first request consumes all three at once, so "Generate another" is immediately paid. | Kept (it maximises the "wow" moment). The paywall appears right after the comparison, where intent is highest. |
| Paid: 7 generations + 2 alterations | Multi-angle card views weren't priced into the allowance. | Card angles don't consume generations, but full-card builds are capped (3/period, configurable) and cached per selected look. A failed build is refunded. |
| £2.99/month | Low price + PayPal fixed fee (~30p) eats ~10–15% of revenue. | Economics still work (below). **Done:** a one-off **Starter Pack** (£2.99 / $4.99) is now the primary paid offer, with Plus as the monthly option. Many people need one haircut, not a subscription. Test £3.99 later. |
| "Measurements" in the card | Images can't give reliable cm. | Card text uses visual landmarks; a sanitiser strips invented cm/inch/clipper grades unless the user supplied them. |
| Multi-angle views | Back and side views are the least reliable (the model never saw them). | Views are labelled; failed views say so. Consider labelling back views "approximate" after real-world QA. |
| Model names | GPT Image 2.5 Flare/Sunburst exist (released 8 Sept 2026) but IDs/prices may change. | Model names, qualities and sizes are admin settings with env overrides; provider code is swappable. The text model defaults to `gpt-5-mini` — **confirm the best current text model at launch**. |
| Age | Photos of minors are a higher-risk category. | 18+ confirmation at upload; terms forbid images of children. |

### Unit economics (estimates, verify against your OpenAI invoice)

Published GPT Image 2.5 token pricing gives roughly $0.013 (medium) / $0.053 (high) per 1024² output, plus
input-image tokens (the selfie is re-sent on every edit; budget ~$0.01–0.02 extra per call).

| Scenario | Images | Approx. AI cost |
|---|---|---|
| Free user (3 medium concepts + analysis) | 3 | ~$0.10 |
| Heavy Plus month (7 high concepts + 2 high alterations + 3 cards × 3–4 medium views + text) | ~20 | ~$0.90–1.20 |
| Plus revenue after PayPal fees (£2.99) | | ~£2.55 ≈ $3.40 |

Free-to-paid conversion must be above roughly 3% to cover free-tier cost at these prices. The admin
dashboard shows estimated API cost (from `cost_estimates_usd`, tune it to the real invoice) next to revenue.

## 2. Pre-launch verification with real credentials

Run in PayPal **sandbox** and a staging Supabase project:

1. Anonymous visitor uploads photo → analysis shows three distinct directions (try: long hair + "shorter but bun-able").
2. Wrong photo types: group photo, no face, hat covering hair, screenshot of text → each gives the specific message.
3. Email code arrives (check the custom SMTP), verify → three images generated; check identity, clothing and background are preserved; check a reference photo's face is **not** copied.
4. `free_allowance_completed` fires; generate another → paywall.
5. Subscribe with a sandbox buyer (GBP and USD) → return page shows active; confirm `payments` row and `PAYMENT.SALE.COMPLETED` processed once (resend it from PayPal's dashboard: still one row).
6. Seven generations then the 8th is refused; two alterations then the 3rd is refused.
7. Kill a generation mid-flight (or set a wrong image model) → credit refunded, human error shown.
8. Choose a look → full card builds 3–4 angles; download PNG and "Save as PDF"; email arrives with QR; scan QR on a phone.
9. Revoke → old QR link dead; share again → new link works.
10. Cancel in the app → status cancelled, access until period end; simulate `BILLING.SUBSCRIPTION.SUSPENDED` and `EXPIRED` from the sandbox webhook simulator.
11. Delete project and delete account → objects gone from all three buckets.
12. Run `maintenance` manually with the cron secret; check expired sources are removed.
13. Accessibility: keyboard-only pass through the whole flow; VoiceOver/TalkBack on the results and card pages; axe scan.
14. Legal review of Privacy/Terms/Cookies (templates are included, not legal advice); register with the ICO if you're a UK controller; DPIA recommended because you process photos of faces at scale.

## 3. Launch plan

- **Soft launch (weeks 1–2):** 100–300 users from friends, local barbers and a Reddit/Discord community. Watch the funnel in Admin daily: `upload_started → upload_completed → email_verified → generation_3 → hairstyle_selected → paywall_viewed → checkout_started → subscription_completed`.
- **Quality gate:** manually review 50 generations for identity drift before paid acquisition. Tune the prompts in `core/prompts.ts` (bump `PROMPT_VERSION`).
- **Pricing test:** after 500 verified users, A/B £2.99/month vs £4.99 one-off Style Pack.

## 4. Promotion

- **The card is the marketing.** Every shared QR page carries "Made with CutCard". Add an opt-in "share my before/after" to build a consented gallery.
- **Barber and salon partnerships:** a salon-branded link (`?ref=salon`) and a printed QR on the mirror ("Not sure what to ask for? Try it first"). Salons benefit from fewer miscommunicated cuts. Next: a salon dashboard that receives clients' cards before appointments.
- **Content:** short vertical videos: "I asked for X, here's what I showed my barber" — before/card/after. Target search terms like "what haircut should I get", "how to ask barber for …", "haircut for thick wavy hair".
- **SEO:** evergreen pages per common request ("shoulder-length cut you can still tie up", "low-maintenance professional haircut") that link into `/start`.
- **Referral:** give both sides one extra style (a `credit_grants` row with no payment).

## 5. Scaling

| Pressure | Current design | Next step when needed |
|---|---|---|
| Generation latency / edge wall-clock | Background tasks in edge functions (`EdgeRuntime.waitUntil`), 3 in parallel, maintenance recovers stuck jobs | Move to a queue (Supabase Queues/pgmq) + worker; add realtime subscription instead of polling |
| OpenAI rate limits | Retry once on 429, human "busy" message, refunds | Per-minute global token bucket in `rate_limits`; second provider via `ImageProvider` |
| Cost | Flare for exploration, cached analyses, capped card builds | Lower free quality to `low` for first pass; batch card views into one call if the API allows multi-image output |
| Storage | Private buckets with retention | Lifecycle is already enforced; add thumbnails to cut egress |
| Abuse | Email OTP, disposable-domain list, hashed IP/device limits | Turnstile on anonymous sign-in (config ready), phone OTP for high-risk IPs |
| Analytics | First-party `analytics_events` table | Export to PostHog/BigQuery once volume grows (events are already whitelisted and non-personal) |
