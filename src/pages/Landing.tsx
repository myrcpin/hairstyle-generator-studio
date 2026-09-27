import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { trackClient } from "../lib/analytics";
import { usePublicConfig } from "../lib/publicConfig";
import { APP_NAME } from "../lib/config";
import { formatPrice } from "../../supabase/functions/_shared/core/pricing.ts";
import { PricingTable } from "./Pricing";
import { pendingReferral } from "../lib/referral";

/** Real example photography lives in /public/examples (see README). Falls back to a neutral frame. */
function ExampleImage({ src, alt, label }: { src: string; alt: string; label: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <figure className="flex flex-col">
      <div className="aspect-[2/3] overflow-hidden bg-paper-2">
        {!failed ? (
          <img src={src} alt={alt} className="h-full w-full object-cover" onError={() => setFailed(true)} loading="lazy" />
        ) : (
          <div className="flex h-full items-end p-4" aria-hidden="true">
            <svg viewBox="0 0 120 160" className="mx-auto h-4/5 text-line"><circle cx="60" cy="62" r="30" fill="currentColor" /><path d="M20 160c4-38 24-56 40-56s36 18 40 56" fill="currentColor" /><path d="M28 60c0-26 16-40 32-40s34 12 34 38c-8-10-20-16-34-16s-24 8-32 18z" fill="#cfc6b8" /></svg>
          </div>
        )}
      </div>
      <figcaption className="mt-2 eyebrow">{label}</figcaption>
      {failed && import.meta.env.DEV && <p className="text-[12px] text-bad">Add {src} (consented example photo)</p>}
    </figure>
  );
}

export default function Landing() {
  const { plan, pack, currency } = usePublicConfig();
  const invited = pendingReferral();
  useEffect(() => { trackClient("landing_viewed"); }, []);
  const price = plan.prices[currency]?.amount;
  const packPrice = pack.prices[currency]?.amount;

  return (
    <>
      {invited && (
        <div role="status" className="border-b border-line bg-card">
          <p className="container-x py-3 text-[14px] text-ink-2">A friend invited you — try 3 styles free, and get a bonus style if you pick up a {pack.name}.</p>
        </div>
      )}
      <section className="container-x grid gap-10 pb-16 pt-10 sm:pt-16 lg:grid-cols-[1.1fr_1fr] lg:items-center">
        <div>
          <p className="eyebrow">Personal hairstyle previews</p>
          <h1 className="mt-4 text-[52px] leading-[0.98] sm:text-[76px]">See your next haircut before you cut it.</h1>
          <p className="mt-6 max-w-xl text-[18px] leading-relaxed text-ink-2">
            Upload your photo. Describe what you want. Get personalised hairstyle ideas — then turn your favourite into a visual guide for your barber or stylist.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link to="/start" className="btn-primary">Try 3 Free Styles</Link>
            <a href="#example" className="btn-secondary">See an Example</a>
          </div>
          <p className="mt-4 text-[14px] text-muted">3 free styles · email required · no card needed · photos deleted automatically</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <ExampleImage src="/examples/before.jpg" alt="Example: original photo before the haircut" label="Your photo" />
          <div className="translate-y-8">
            <ExampleImage src="/examples/after.jpg" alt="Example: the same person with a personalised shoulder-length cut" label="Your next cut" />
          </div>
        </div>
      </section>

      <section id="example" className="scroll-mt-20 border-y border-line/70 bg-card py-16">
        <div className="container-x">
          <p className="eyebrow">The Hairstyle Card</p>
          <h2 className="mt-3 max-w-3xl text-[40px] leading-tight sm:text-[52px]">Not just a hairstyle preview.</h2>
          <p className="mt-3 max-w-2xl text-[17px] text-ink-2">Get the look, the angles, the cutting direction and a shareable Hairstyle Card.</p>
          <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_1.4fr]">
            <div className="grid grid-cols-2 gap-3">
              <ExampleImage src="/examples/view-front.jpg" alt="Example card: front view" label="Front" />
              <ExampleImage src="/examples/view-side.jpg" alt="Example card: side view" label="Side" />
              <ExampleImage src="/examples/view-three-quarter.jpg" alt="Example card: three-quarter view" label="3/4 view" />
              <ExampleImage src="/examples/view-back.jpg" alt="Example card: back view" label="Back" />
            </div>
            <div className="border border-line bg-paper p-6 sm:p-8">
              <p className="eyebrow">{APP_NAME} · Hairstyle Card</p>
              <h3 className="mt-1 text-[40px] leading-none">Soft Shoulder Cut</h3>
              <div className="mt-6 space-y-5 text-[15px]">
                <div className="border-t border-line pt-3">
                  <p className="text-[12px] font-semibold uppercase tracking-[0.14em]">What to ask for</p>
                  <p className="mt-1 font-display text-[22px] leading-snug">“Keep the overall length around shoulder level. Add light internal layers to reduce bulk without making the ends thin. Keep enough length at the sides to tuck behind the ears and tie back.”</p>
                </div>
                <div className="grid grid-cols-2 gap-4 border-t border-line pt-3">
                  <div><p className="text-[12px] font-semibold uppercase tracking-[0.14em]">Keep</p><p className="text-ink-2">Enough length for a bun · natural wave</p></div>
                  <div><p className="text-[12px] font-semibold uppercase tracking-[0.14em]">Change</p><p className="text-ink-2">Less weight at the ends · softer shape</p></div>
                </div>
                <div className="border-t border-line pt-3">
                  <p className="text-[12px] font-semibold uppercase tracking-[0.14em]">Maintenance</p>
                  <p className="text-ink-2">Low. Trim every 8–12 weeks; air-dry friendly.</p>
                </div>
              </div>
              <p className="mt-6 text-[12px] text-muted">Example card for illustration. Your card is written for your photo and your request.</p>
            </div>
          </div>
        </div>
      </section>

      <section id="how" className="container-x scroll-mt-20 py-16">
        <p className="eyebrow">How it works</p>
        <h2 className="mt-3 text-[40px] leading-tight sm:text-[52px]">Three steps. No jargon needed.</h2>
        <ol className="mt-10 grid gap-8 sm:grid-cols-3">
          {[
            ["Upload your photo", "A clear, front-facing photo in good light. Add a reference photo of a style you like if you have one."],
            ["Describe what you want", "In your own words — “shorter, but long enough for a bun” is perfect. Optional quick choices help too."],
            ["Get your looks and your card", "Three personalised directions, from subtle to bolder. Pick one and get a Hairstyle Card to show your stylist."],
          ].map(([t, d], i) => (
            <li key={t} className="border-t border-ink pt-4">
              <span className="font-display text-[44px] leading-none text-accent">{i + 1}</span>
              <h3 className="mt-2 text-[26px]">{t}</h3>
              <p className="mt-2 text-ink-2">{d}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="border-y border-line/70 bg-card py-16">
        <div className="container-x">
          <p className="eyebrow">Pricing</p>
          <h2 className="mt-3 text-[40px] leading-tight">Start free. Upgrade when you've found the one.</h2>
          <div className="mt-8"><PricingTable /></div>
        </div>
      </section>

      <section className="container-x grid gap-10 py-16 lg:grid-cols-2">
        <div>
          <p className="eyebrow">Your photos, handled carefully</p>
          <h2 className="mt-3 text-[40px] leading-tight">Private by default.</h2>
        </div>
        <ul className="space-y-3 text-[16px] text-ink-2">
          <li>• Photos are stored privately and only shown through short-lived secure links.</li>
          <li>• Original photos are deleted automatically after a few days; generated looks after 30 days unless you save them.</li>
          <li>• We never use your photos to train AI models, and we don't do facial recognition.</li>
          <li>• Delete a project — or your whole account — at any time.</li>
        </ul>
      </section>

      <section className="container-x py-12">
        <h2 className="text-[36px]">Questions</h2>
        <div className="mt-6 divide-y divide-line border-y border-line">
          {[
            ["Will it look exactly like this in real life?", "No image can promise that. The looks are realistic visual concepts based on your photo, designed to help you and your stylist agree on a direction. We flag styles that need growth first or that are concepts only."],
            ["Do I need to know hairstyle terms?", "Not at all. Describe it how you'd tell a friend. We translate it into cutting direction for your stylist."],
            ["What does the free version include?", `Three personalised concepts at standard resolution. The ${pack.name}${packPrice ? ` (${formatPrice(packPrice, currency)} once)` : ""} adds more styles, an alteration and the full multi-angle Hairstyle Card with downloads, QR sharing and email. Plus${price ? ` (${formatPrice(price, currency)}/month)` : ""} is the monthly option.`],
            ["Is the Starter Pack a subscription?", "No. You pay once and nothing renews. Plus is the only subscription, and you can cancel it any time from your account."],
            ["I'm a hairdresser — can I use this with clients?", "Yes. Salon plans let your team run consultations on the salon iPad or phone, bill to the salon, and hand clients a Hairstyle Card with your name, logo and booking link."],
          ].map(([q, a]) => (
            <details key={q} className="group py-4">
              <summary className="cursor-pointer list-none text-[18px] font-medium marker:hidden">{q}<span className="float-right text-muted group-open:rotate-45 transition-transform" aria-hidden="true">+</span></summary>
              <p className="mt-2 max-w-3xl text-ink-2">{a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="border-y border-line/70 bg-card py-14">
        <div className="container-x grid gap-6 md:grid-cols-[1.4fr_1fr] md:items-center">
          <div>
            <p className="eyebrow">For salons & barbershops</p>
            <h2 className="mt-2 text-[40px] leading-tight">Agree the cut before the first snip.</h2>
            <p className="mt-2 max-w-xl text-ink-2">Run consultations on the salon iPad, show clients three looks on their own photo, and send them a Hairstyle Card with your branding and booking link.</p>
          </div>
          <Link to="/business" className="btn-secondary justify-self-start md:justify-self-end">See salon plans</Link>
        </div>
      </section>

      <section className="container-x py-12 text-center">
        <h2 className="text-[44px] leading-tight">Try before you cut.</h2>
        <Link to="/start" className="btn-primary mt-6">Try 3 Free Styles</Link>
      </section>
    </>
  );
}
