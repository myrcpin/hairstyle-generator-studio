# Competitor gaps and how CutCard answers them

Research date: September 2026, from public reviews, app-store listings and "we tested N apps" round-ups
(sources at the end). Prices change often; treat them as a snapshot.

## The landscape

| Type | Examples | Typical pricing | What they do |
|---|---|---|---|
| Filter / overlay try-on | YouCam Makeup, FaceApp, older "hairstyle filter" apps | Freemium; YouCam premium from ~$8.49/mo; FaceApp Pro ~$20 | Paste a preset hairstyle over your selfie |
| Generative "hair changer" apps | Hairly AI, Hairstyle AI Pro, AI Hair Try-On & Color Studio, HairApp | Weekly plans are common: $3.99/week, $7.99/week; yearly $29.99–$39.99; free trials of 3–7 days | Generate a new photo with a chosen preset style |
| Photo-pack generators | HairstyleAI | One-off ~$9 for a pack of styles/photos | Batch of AI photos in many preset styles |
| Salon software with consultation tools | Phorest (face-mapping, before/after imaging), plus booking suites like GlossGenius and Mangomint | $24–$200+/month, usually bundled with booking | Consultation imaging as a feature inside a large salon system |

## Where competitors fall short

1. **Wig-like, unrealistic results.** Reviewers repeatedly say many apps "place a wig-like filter" on the selfie, which is hard to believe or act on.
2. **Preset catalogues, not your request.** Most apps make you pick from 60–500 presets. Very few interpret what you *actually* said ("shorter but still long enough for a bun").
3. **No path to the chair.** The output is a single selfie. There's nothing structured to show a barber: no angles, no cutting direction, no length landmarks. The value stops at the phone screen.
4. **No honesty about feasibility.** Apps happily show long, thick hair on someone with a short, fine cut, with no warning that it isn't achievable soon.
5. **Subscription traps.** Weekly plans ($3.99–$7.99/week), trials that silently convert, hard-to-find cancellation, and refusals to refund are the most common app-store complaints.
6. **Identity drift.** Generated faces subtly change (skin, jaw, age), so the preview no longer looks like you.
7. **Privacy is an afterthought.** Face photos are kept indefinitely, retention is rarely stated, and training use is unclear.
8. **Salons are underserved.** Consultation imaging exists only inside expensive all-in-one salon suites. There's no light tool a stylist can use in the chair and hand to the client with the salon's name on it.

## How CutCard is better, and what's built

| Gap | CutCard | Status |
|---|---|---|
| Wig-like results, identity drift | Edits *your* photo; prompts lock face, skin, clothing and background; reference photos are fenced to "hairstyle only" | Built |
| Presets instead of your words | Plain-English request is turned into a structured brief, then three deliberately different directions (subtle / balanced / bolder) | Built |
| No path to the chair | **Hairstyle Card**: front, 3/4, side and back views, "what to ask for", keep/change, length guide by landmarks, styling, upkeep, QR and email | Built. This is the differentiator. |
| Unrealistic promises | Feasibility labels on every look ("needs growth", "visual concept"), feasibility warnings, a disclaimer on every card, and invented measurements stripped out | Built |
| Subscription traps | **Starter Pack is one-off (£2.99 / $4.99), nothing renews.** Plus is optional. Cancel is in the account page, and access lasts to the end of the paid period. Technical failures never use a credit. | Built |
| Privacy | Private storage, signed links, source photos deleted after 7 days, generated images after 30, one-click project and account deletion, no training use, no facial recognition | Built |
| Salons underserved | **Salon plans**: in-chair consultations billed to the salon, branded cards (name, logo, booking link), email the card to the client, staff seats, session history | Built (MVP) |
| Growth that doesn't rely on ads | Cards carry the brand and QR; referral: 3 friends buy a pack → free month (max 3); the salon's booking link rides on every client card | Built |
| Learning what customers need | 5-question post-purchase survey (haircut frequency, where they cut, past bad cuts, bring references, spend) with admin results and CSV export | Built |

## What to watch or do next

- **Quality is the moat, and it must be proven.** Before paid acquisition, blind-test 50 CutCard outputs against 2–3 top generative apps on identity preservation and realism.
- **Back and side views** are where every generator is weakest. Label them clearly, and measure how often users remove or regenerate them.
- **Survey-driven features.** For example, if "left unhappy" is above ~40%, lead marketing with "never get the wrong cut again". If most people cut every 5–8 weeks, add an opt-in "time for a trim" reminder (the question already exists in the pool).
- **Salon distribution:** a partnership with a booking platform (Fresha, Phorest, GlossGenius) matters more than any feature. The booking link on each card is the hook.

## Sources

- [TheRightHairstyles — free try-on tools guide (2026)](https://therighthairstyles.com/free-hairstyle-try-on-tools-and-apps/) and [AI app recommendations tested](https://therighthairstyles.com/ai-hair-app-recommendations-tested/)
- [Perfect Corp — "I tested 12 hairstyle try-on apps"](https://www.perfectcorp.com/consumer/blog/hair/best-ai-hairstyle-testing-apps)
- [CutMuse — 10 best AI hairstyle apps 2026](https://blog.cutmuse.com/en/blog/best-ai-hairstyle-apps-2026-tested-compared)
- App Store listings: [Hairly AI](https://apps.apple.com/us/app/hairly-ai-hairstyle-try-on/id6754688430), [Hairstyle AI](https://apps.apple.com/us/app/hairstyle-ai-hairstyle-try-on/id6740616086), [HairApp reviews](https://apps.apple.com/us/app/hairapp-ai-hairstyle-try-on/id6740919592?see-all=reviews&platform=iphone), [AI Hair Try-On & Color Studio](https://apps.apple.com/app/id6753914047), [Hair AI reviews](https://apps.apple.com/us/app/hair-ai-hairstyle-filter-cut/id6695743833?see-all=reviews)
- [HairstyleAI pricing](https://hairstyleai.net/pricing), [YouCam Makeup pricing overview](https://www.aichatdaily.com/tools/youcam-makeup), [FaceApp pricing FAQ](https://www.faceapp.com/faq/how-much-does-faceapp-cost/)
- Salon software: [Capterra salon software](https://www.capterra.com/salon-software/), [Dingg — salon software cost 2026](https://dingg.app/blogs/how-much-does-salon-software-cost-in-the-us-2025-guide), [Salon Booking System — hairdresser software 2026](https://www.salonbookingsystem.com/salon-booking-system-blog/hairdresser-appointment-software/)
