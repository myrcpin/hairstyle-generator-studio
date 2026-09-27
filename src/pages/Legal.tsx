import type { ReactNode } from "react";
import { APP_NAME, COMPANY_ADDRESS, COMPANY_NAME, SUPPORT_EMAIL } from "../lib/config";
import { PageTitle } from "../components/ui";

function Doc({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="container-x max-w-3xl py-12">
      <PageTitle eyebrow="Legal" title={title}><p className="text-[14px] text-muted">Last updated 26 September 2026</p></PageTitle>
      <div className="space-y-5 text-[16px] leading-relaxed text-ink-2 [&_h2]:mt-8 [&_h2]:text-[28px] [&_h2]:text-ink [&_li]:ml-5 [&_li]:list-disc">{children}</div>
    </div>
  );
}

export function Privacy() {
  return (
    <Doc title="Privacy Policy">
      <p>{APP_NAME} is operated by {COMPANY_NAME}{COMPANY_ADDRESS ? `, ${COMPANY_ADDRESS}` : ""} (“we”). We are the controller of the personal data described here. Contact: {SUPPORT_EMAIL}.</p>
      <h2>What we collect</h2>
      <ul>
        <li><strong>Photos you upload</strong> (your photo and any hairstyle reference photos) and the text you write about the style you want.</li>
        <li><strong>Generated images and Hairstyle Cards</strong> created from your photos.</li>
        <li><strong>Account data</strong>: your email address and whether it is verified.</li>
        <li><strong>Billing data</strong>: subscription status and payment records from PayPal. We never see or store your card details.</li>
        <li><strong>Security data</strong>: a salted, one-way hash of your IP address and of a random browser identifier, used only to prevent abuse of free styles.</li>
        <li><strong>Survey answers</strong> (optional): after a purchase we ask five multiple-choice questions about your haircut habits, such as how often you get your hair cut. They're linked to your account.</li>
        <li><strong>Referral data</strong>: which invite link you signed up with. The person who invited you only sees a count, never your identity or purchase.</li>
        <li><strong>Salon consultations</strong>: if a salon uses {APP_NAME} with you, the salon decides why your photo is processed (it is the controller) and we process it on its behalf.</li>
        <li><strong>Usage events</strong> (for example “upload completed”). Anonymous product analytics identifiers are only set with your consent.</li>
      </ul>
      <h2>How we use it</h2>
      <ul>
        <li>To create hairstyle concepts and Hairstyle Cards you ask for (performance of our contract with you).</li>
        <li>To run subscriptions and keep payment records (contract and legal obligation).</li>
        <li>To prevent abuse and keep the service secure (legitimate interests).</li>
        <li>To understand and improve the product using aggregated analytics (consent).</li>
        <li>To learn about customers' haircut habits from optional survey answers, so we can improve recommendations and offers (legitimate interests; you can skip the survey, and ask us to delete your answers at any time). Answers are reported in aggregate or pseudonymised, never sold.</li>
      </ul>
      <h2>What we don't do</h2>
      <ul>
        <li>We do not perform facial recognition, identity verification or identity matching. Your photo is used only as a picture to edit.</li>
        <li>We do not use your photos to train AI models, and we use API settings that do not permit our providers to train on them.</li>
        <li>We do not sell your data or use it for advertising.</li>
      </ul>
      <h2>Who processes it for us</h2>
      <ul>
        <li>Supabase (database, authentication, private file storage).</li>
        <li>OpenAI (image generation and text analysis via API).</li>
        <li>PayPal (payments). Resend (transactional email).</li>
      </ul>
      <p>Some providers process data outside the UK/EEA under appropriate safeguards such as Standard Contractual Clauses or the UK International Data Transfer Addendum.</p>
      <h2>How long we keep it</h2>
      <ul>
        <li>Original photos: deleted automatically a few days after upload (7 days by default).</li>
        <li>Generated images: deleted after 30 days, or longer only if you choose to save a project on Plus.</li>
        <li>Shared card links: expire after 90 days by default, or when you revoke them.</li>
        <li>Unverified sessions: deleted after 7 days. Payment records: kept as required by tax law.</li>
      </ul>
      <h2>Your rights</h2>
      <p>You can access, correct, export or delete your data, object to processing, and withdraw consent at any time. Delete projects or your whole account from “My styles”, or email {SUPPORT_EMAIL}. You may complain to the UK Information Commissioner's Office (ico.org.uk) or your local supervisory authority.</p>
      <h2>Photos of other people</h2>
      <p>Only upload your own photo as the main photo. Reference photos must be ones you have permission to use; we use them only for their hairstyle characteristics.</p>
      <p className="text-[13px] text-muted">This policy is a starting template and should be reviewed by a qualified adviser before launch.</p>
    </Doc>
  );
}

export function Terms() {
  return (
    <Doc title="Terms of Service">
      <p>These terms apply to your use of {APP_NAME}, provided by {COMPANY_NAME}. By using the service you agree to them.</p>
      <h2>The service</h2>
      <p>{APP_NAME} creates AI-generated visual concepts of hairstyles from photos you upload and produces a Hairstyle Card to help you communicate with a barber or stylist.</p>
      <h2>AI-generated images</h2>
      <p>All hairstyle images are AI-generated concepts. They are a communication aid, not a guarantee. Your real result depends on your hair's length, density and texture, your stylist, and how you style it. Some styles are labelled as needing growth or as visual concepts only. We do not promise that any haircut will look exactly like an image.</p>
      <h2>Your uploads</h2>
      <ul>
        <li>You must be 18 or over. Your main photo must be of you.</li>
        <li>You confirm you have the rights and permission to upload any reference photos. We use them only for hairstyle characteristics, never to reproduce another person's identity.</li>
        <li>Don't upload unlawful, sexual, violent or otherwise inappropriate images, or images of children. We may refuse or delete such content.</li>
        <li>You keep ownership of your photos. You give us a limited licence to process them only to provide the service.</li>
      </ul>
      <h2>Starter Pack</h2>
      <p>The Starter Pack is a one-off purchase of extra styles, alterations and a full Hairstyle Card, plus Plus features for a limited period (shown at checkout). It does not renew. Unused credits expire at the end of that period.</p>
      <h2>Referrals</h2>
      <p>When three people who signed up with your invite link each buy a Starter Pack, you get one free month of Plus features and allowance, up to three times. Invites only count for new accounts that haven't purchased before, and not from the same device. Rewards have no cash value. We may withhold rewards obtained by abuse, such as fake or self-created accounts.</p>
      <h2>Salon plans</h2>
      <p>Salon plans are for businesses. The salon is responsible for getting its clients' agreement before photographing them and for how it uses the cards. We process client photos on the salon's behalf under our data processing terms, available on request.</p>
      <h2>Free use and Plus</h2>
      <p>Free use includes a limited number of concepts and requires a verified email. Plus is a monthly subscription billed through PayPal. Allowances reset each billing period and do not roll over. If a generation fails for technical reasons, it isn't counted. You can cancel at any time; access continues until the end of the paid period. Statutory rights, including any right to cancel under consumer law, are not affected — by starting generations immediately you agree the digital service begins straight away.</p>
      <h2>Acceptable use</h2>
      <p>No automated access, abuse of free allowances (for example multiple accounts), or attempts to bypass limits or security.</p>
      <h2>Liability</h2>
      <p>We provide the service with reasonable care and skill. We are not responsible for haircuts carried out by third parties. Nothing in these terms limits liability that cannot be limited by law.</p>
      <h2>Contact</h2>
      <p>{SUPPORT_EMAIL}</p>
      <p className="text-[13px] text-muted">These terms are a starting template and should be reviewed by a qualified adviser before launch.</p>
    </Doc>
  );
}

export function Cookies() {
  return (
    <Doc title="Cookie Policy">
      <p>{APP_NAME} does not use advertising or cross-site tracking cookies.</p>
      <h2>Strictly necessary storage</h2>
      <ul>
        <li><strong>Sign-in session</strong> (browser local storage, set by Supabase Auth) — keeps you signed in and links your uploads to you.</li>
        <li><strong>Security identifier</strong> (<code>cc_device</code>) — a random value used, after one-way hashing on our servers, to limit abuse of free styles.</li>
        <li><strong>Preferences</strong> (<code>cc_currency</code>, <code>cc_analytics_consent</code>) — remember your currency and privacy choice.</li>
      </ul>
      <h2>Optional analytics</h2>
      <ul>
        <li><strong><code>cc_anon</code></strong> — an anonymous random id that lets us count steps in the product (for example how many people finish an upload). Only set if you choose “Allow analytics”. No third-party analytics service receives it.</li>
      </ul>
      <p>Payment pages are hosted by PayPal, which sets its own cookies under its own policy.</p>
      <p>You can change your choice at any time by clearing this site's storage in your browser.</p>
    </Doc>
  );
}
