# Starter Pack, customer survey, referrals and salon plans

All numbers below are defaults. Change them in **Admin → Configuration** (the `plans` table and the `referrals` / `survey` settings) without a deploy.

## Starter Pack (one-off)

- **£2.99 / $4.99, paid once through PayPal (Orders API). Nothing renews.**
- Includes 5 new styles, 1 alteration, 1 full Hairstyle Card, and Plus features (high-res downloads, QR, email) for 60 days.
- Flow: Pricing → PayPal → `/billing/pack-return?token=<order>`. The server **captures** the order and checks that the owner (`custom_id`), amount and currency match before granting anything. The `PAYMENT.CAPTURE.COMPLETED` webhook runs the same fulfilment, and both paths are idempotent on the capture id.
- The grant is stored in `credit_grants` (`grants_access = true`). Credits are used in this order: subscription → earliest-expiring grant → free.

## Post-purchase survey (5 questions)

- Shown straight after the pack purchase, emailed at the same time ("5 quick questions"), and nudged on the account page until answered.
- It's one question per screen, tap to answer, about 20 seconds. Completing it adds **1 bonus style** (`survey.reward_generations`).
- Active questions (yes/no or single choice):
  1. How often do you get your hair cut? (2–4 weeks / 5–8 weeks / 2–3 months / less often)
  2. Where do you usually get it cut? (barber / salon / mobile or home / myself)
  3. Have you ever left a haircut unhappy because it wasn't what you asked for? (yes/no)
  4. Do you usually show your stylist a photo of what you want? (yes/no)
  5. Roughly how much do you spend on a haircut? (bands, shown in the customer's currency)
- Reserve pool you can swap in from Admin (max 5 active): same stylist each time?, do you colour your hair?, what matters most (low maintenance / professional / new look / fix a problem), would you like a reminder when you're due a cut?, would you book a recommended stylist through us?
- **What the data is for:**
  - Frequency plus a reminder opt-in → a trim-reminder feature.
  - Barber vs salon → wording and default styles.
  - "Left unhappy" rate → marketing message.
  - Brings a reference → validates the card.
  - Spend band → pricing tests.
  - Would book → proof of demand for a stylist marketplace.
- **Privacy:** it's optional and skippable. Answers are linked to the account, deleted with it, and covered in the Privacy Policy (legitimate interests). Admin shows aggregates, and the CSV export is pseudonymised with a fresh salt per export.

## Referrals

- Every verified user gets a link (`/?ref=CODE`) and a share button (native share sheet on mobile, copy elsewhere).
- **Rule: 3 friends who sign up with your link and buy a Starter Pack = 1 free month of Plus. Up to 3 times (3 months).** Friends get 1 bonus style with their pack.
- The free month is a 30-day grant with Plus access plus a month's allowance (7 styles, 2 alterations, 3 full cards). It works whether or not the referrer subscribes, and doesn't touch their PayPal billing. Later months start when the previous one ends, so they don't overlap.
- The referrer sees a 3-step progress bar, months earned out of 3, and how many people joined. They never see who bought.
- Anti-abuse rules:
  - Only new accounts (14-day window) that haven't bought before can be referred.
  - No self-referral, and the friend can't be on the same browser/device as the referrer.
  - One referrer per account.
  - The reward is serialised per referrer in `qualify_referral()`, so rewards can't be double-granted.
  - Same Wi-Fi is deliberately allowed, since flatmates are who people share with.
- **Economics:** 3 packs = £8.97 revenue (about £7.80 after PayPal fees). A free month costs about $1 of AI. Faking friends would cost more than the reward is worth.

## Business package (salons & barbershops)

| Plan | Price | Client looks / month | Alterations | Full branded cards | Staff |
|---|---|---|---|---|---|
| Salon | £29 / $39 | 60 | 20 | 40 | 3 |
| Salon Pro | £59 / $79 | 150 | 50 | 100 | 10 |

What a salon gets:

- **In-chair consultation mode** (`/start?org=<id>`): staff take the client's photo, tick the client-consent box, add optional initials, and the three looks start immediately. The client doesn't need an account or email.
- **Billing to the salon.** Salon usage comes from the salon's monthly pool (`reserve_org_usage`), never the stylist's personal credits.
- **Branded Hairstyle Card:** "Prepared by <salon>", the salon logo, and a "Book with <salon>" button on the card, the public QR page and the email.
- **Send the card to the client's email** from the card page, once the client asks for it.
- **Dashboard** (`/business/dashboard`): plan and remaining counts, subscribe or cancel through PayPal (salon subscriptions use `custom_id = org:<id>`), branding (logo upload, booking link), recent consultations, and team management with single-use 7-day invite links.
- **Access:** staff of a salon can see that salon's sessions (RLS). Outsiders can't.
- **Data roles:** the salon is the controller for its clients' photos and CutCard is the processor. The Terms and Privacy Policy say so. **Have a Data Processing Agreement ready before selling to salons.**

**Setup:** create PayPal plans for `business_studio` and `business_pro` in GBP and USD, and paste their ids into Admin → Plans. The same webhook handles salon subscriptions.

**Next steps for business:**
- a public salon page (`/s/<slug>`) where clients self-serve on the salon's credits
- a booking-platform integration
- per-stylist stats
- white-label domain on Pro
