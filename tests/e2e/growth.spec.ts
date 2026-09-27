import { expect, test, type Browser, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { MockBackend } from "./mockBackend";

const fixture = (f: string) => fileURLToPath(new URL(`./fixtures/${f}`, import.meta.url));
const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/screens/${name}.png`, fullPage: true });

async function newPage(browser: Browser, be: MockBackend) {
  const ctx = await browser.newContext({ locale: "en-GB", timezoneId: "Europe/London", viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await be.install(page);
  await page.addInitScript(() => { try { localStorage.setItem("cc_analytics_consent", "denied"); } catch { /* ignore */ } });
  return page;
}

async function signIn(page: Page, email: string, next = "/account") {
  await page.goto(`/signin?next=${next}`);
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await page.getByLabel("6-digit code").fill("123456");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(new RegExp(next.replace(/[?]/g, "\\?")));
}

test("referral: 3 friends buy a Starter Pack → referrer gets a free month; buyer answers 5-question survey", async ({ browser }) => {
  const be = new MockBackend();

  // Referrer gets their invite link
  const referrer = await newPage(browser, be);
  await signIn(referrer, "ref@example.com");
  await expect(referrer.getByRole("heading", { name: /3 friends buy a Starter Pack/ })).toBeVisible();
  await expect(referrer.getByText("0/3 friends towards your next free month")).toBeVisible();
  const link = await referrer.getByLabel("Your invite link").inputValue();
  expect(link).toMatch(/\?ref=FRIEND/);

  for (let i = 1; i <= 3; i++) {
    const friend = await newPage(browser, be);
    await friend.goto(link.replace("http://localhost:5174", ""));
    await expect(friend.getByText("A friend invited you")).toBeVisible();
    await signIn(friend, `friend${i}@example.com`, "/pricing");
    await friend.getByRole("button", { name: "Get the Starter Pack" }).click();
    await expect(friend.getByRole("heading", { name: "Your Starter Pack is ready." })).toBeVisible();
    if (i === 1) {
      await shot(friend, "10-pack-purchased");
      // Five tap-to-answer questions
      await friend.getByRole("button", { name: "Answer 5 questions" }).click();
      await expect(friend.getByText("Question 1 of 5")).toBeVisible();
      await shot(friend, "11-survey");
      await friend.getByRole("radio", { name: "Every 5–8 weeks" }).click();
      await friend.getByRole("radio", { name: "Barber" }).click();
      await friend.getByRole("radio", { name: "Yes" }).click();
      await friend.getByRole("radio", { name: "No" }).click();
      await friend.getByRole("radio", { name: "£15–£30" }).click();
      await expect(friend.getByRole("heading", { name: "Thank you." })).toBeVisible();
      await expect(friend.getByText("We've added 1 extra style")).toBeVisible();
      expect(be.surveys.get([...be.users.values()].find((u) => u.email === "friend1@example.com")!.id)).toMatchObject({ cut_frequency: "5_8_weeks", spend_band: "15_30" });
      // Account shows pack access (Plus features without a subscription)
      await friend.goto("/account");
      await expect(friend.getByText(/Plus features active until/)).toBeVisible();
    }
    await friend.context().close();
  }

  await referrer.reload();
  await expect(referrer.getByText(/1\/3 months earned/)).toBeVisible();
  await expect(referrer.getByText(/Plus features active until/)).toBeVisible();
  await shot(referrer, "12-referral-rewarded");
  for (const e of ["referral_attached", "pack_purchased", "survey_completed", "referral_rewarded"]) expect(be.events).toContain(e);
});

test("salon: create salon → subscribe → client consultation → branded card emailed to client", async ({ browser }) => {
  const be = new MockBackend();
  const page = await newPage(browser, be);
  await signIn(page, "owner@salon.example", "/business");
  await expect(page.getByRole("heading", { name: "Consultations your clients can see." })).toBeVisible();
  await page.getByLabel("Salon name").fill("North Street Barbers");
  await page.getByLabel(/Booking link/).fill("https://book.example.com/north-street");
  await page.getByRole("button", { name: "Create salon account" }).click();
  await expect(page.getByRole("heading", { name: "North Street Barbers" })).toBeVisible();
  await page.getByRole("button", { name: /Salon — £29\.00\/month/ }).click();
  await expect(page.getByText("Your salon plan is active.")).toBeVisible();
  await shot(page, "13-salon-dashboard");

  await page.getByRole("link", { name: "New client consultation" }).click();
  await expect(page.getByRole("heading", { name: "Start with a photo of your client." })).toBeVisible();
  await page.getByLabel("Client photo", { exact: true }).setInputFiles(fixture("selfie.jpg"));
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Describe what you want").fill("Tidy fade, keep length on top");
  await page.getByLabel(/Client name or initials/).fill("J.D.");
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: "Plan my looks" }).click();

  await expect(page.getByText("Client consultation · J.D.")).toBeVisible();
  // Staff are already verified, so the three looks start immediately (no email step for the client).
  await expect(page.getByAltText(/You with the .* hairstyle/)).toHaveCount(3, { timeout: 30_000 });
  await expect(page.getByText(/free styles? left/)).toHaveCount(0);
  await page.getByRole("button", { name: "Choose this" }).first().click();

  await expect(page.getByText("Prepared by")).toBeVisible();
  await expect(page.getByRole("link", { name: "Book with North Street Barbers" })).toBeVisible();
  await expect(page.getByAltText("Back of the chosen hairstyle")).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Email to your client").fill("client@example.com");
  await page.getByRole("checkbox", { name: /asked for their card/ }).check();
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Sent to client@example.com.")).toBeVisible();
  expect(be.emails.at(-1)?.to).toBe("client@example.com");
  await shot(page, "14-salon-card");

  // Session shows up on the dashboard
  const orgId = String(be.orgs[0].id);
  await page.goto(`/business/dashboard?org=${orgId}`);
  await expect(page.getByRole("link", { name: "J.D." })).toBeVisible();
  // Personal free credits untouched by salon work
  expect(be.usage.get([...be.users.values()].find((u) => u.email === "owner@salon.example")!.id)?.free ?? 0).toBe(0);
});
