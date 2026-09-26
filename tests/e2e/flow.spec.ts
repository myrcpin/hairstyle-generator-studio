import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { MockBackend } from "./mockBackend";

const fixture = (f: string) => fileURLToPath(new URL(`./fixtures/${f}`, import.meta.url));
const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/screens/${name}.png`, fullPage: true });

async function acceptConsent(page: Page) {
  const btn = page.getByRole("button", { name: "Essential only" });
  if (await btn.isVisible().catch(() => false)) await btn.click();
}

async function uploadAndDescribe(page: Page, description: string) {
  await page.goto("/start");
  await acceptConsent(page);
  await page.getByLabel("Your photo", { exact: true }).setInputFiles(fixture("selfie.jpg"));
  await expect(page.getByAltText("Your photo preview")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Describe what you want").fill(description);
  await page.getByRole("radio", { name: "Long", exact: true }).click();
  await page.getByRole("button", { name: "Professional" }).click();
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: "Plan my looks" }).click();
}

test("anonymous visitor → free looks → pay → alter → full card → QR → download → email → cancel", async ({ page }) => {
  const be = new MockBackend();
  await be.install(page);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  // Landing
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "See your next haircut before you cut it." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Try 3 Free Styles" }).first()).toBeVisible();
  await expect(page.getByText("£2.99").first()).toBeVisible();
  await shot(page, "01-landing");
  await acceptConsent(page);

  // Upload validation: wrong type and too small are rejected with human messages
  await page.goto("/start");
  await page.getByLabel("Your photo", { exact: true }).setInputFiles(fixture("not-an-image.txt"));
  await expect(page.getByRole("alert")).toContainText("JPG, PNG or WebP");
  await page.getByLabel("Your photo", { exact: true }).setInputFiles(fixture("too-small.jpg"));
  await expect(page.getByRole("alert")).toContainText("at least 512 pixels");

  // Upload + describe → plan
  await uploadAndDescribe(page, "Shorter but keep enough length for a bun. Professional and easy to maintain.");
  await expect(page).toHaveURL(/\/project\//);
  await expect(page.getByRole("heading", { name: "Three directions, planned for you." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Soft Shoulder Cut" })).toBeVisible();
  await shot(page, "02-plan-email-gate");

  // Email verification (wrong code first)
  await page.getByLabel("Email address").fill("sam@example.com");
  await page.getByRole("button", { name: "Send my code" }).click();
  await page.getByLabel("6-digit code").fill("000000");
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page.getByRole("alert")).toContainText("That code didn't work");
  await page.getByLabel("6-digit code").fill("123456");
  await page.getByRole("button", { name: "Verify and continue" }).click();

  // Generation auto-starts after verification; three concepts appear
  await expect(page.getByRole("heading", { name: "Compare your looks." })).toBeVisible();
  await expect(page.getByAltText(/You with the .* hairstyle/)).toHaveCount(3, { timeout: 30_000 });
  await expect(page.getByText("0 free styles left.")).toBeVisible();
  await expect(page.getByText("Found one you like? Get the full Hairstyle Card.")).toBeVisible();
  await shot(page, "03-results-free");

  // Free user: alter → paywall; generate another → paywall (no credits)
  await page.getByRole("button", { name: "Alter this" }).first().click();
  await expect(page.getByRole("dialog", { name: "Upgrade to Plus" })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Generate another like this" }).first().click();
  await expect(page.getByRole("dialog", { name: "Upgrade to Plus" })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();

  // Choose → preview card (watermarked, paywalled)
  await page.getByRole("button", { name: "Choose this" }).nth(1).click();
  await expect(page).toHaveURL(/\/card\//);
  const cardUrl = page.url();
  await expect(page.getByRole("heading", { level: 2, name: "Soft Shoulder Cut" })).toBeVisible();
  await expect(page.getByText("Preview", { exact: true })).toBeVisible();
  await expect(page.getByText("What to ask for")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Unlock the full Hairstyle Card" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download card" })).toHaveCount(0);
  await shot(page, "04-card-preview");

  // Pay (PayPal approval simulated by redirect to /billing/return)
  await page.getByRole("link", { name: /Get Plus/ }).first().click();
  await expect(page).toHaveURL(/\/pricing/);
  await page.getByRole("button", { name: "Get Plus" }).click();
  await expect(page.getByRole("heading", { name: "Welcome to Plus." })).toBeVisible();
  await shot(page, "05-subscribed");

  // Back to the card: build the full card
  await page.goto(cardUrl);
  await page.getByRole("button", { name: "Build full card" }).click();
  await expect(page.getByAltText("3/4 view of the chosen hairstyle")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByAltText("Side of the chosen hairstyle")).toBeVisible();
  await expect(page.getByAltText("Back of the chosen hairstyle")).toBeVisible();
  await expect(page.getByAltText("QR code that opens this Hairstyle Card")).toBeVisible();
  await shot(page, "06-card-full");

  // Download card PNG
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download card" }).click()]);
  expect(download.suggestedFilename()).toBe("hairstyle-card-soft-shoulder-cut.png");
  await expect(page.getByRole("link", { name: /Download front image/ })).toBeVisible();

  // Email it
  await page.getByRole("button", { name: "Email it to me" }).click();
  await expect(page.getByText("Sent! Check your inbox")).toBeVisible();
  expect(be.emails).toHaveLength(1);

  // Public QR page
  const publicUrl = (await page.locator("p.break-all").innerText()).trim();
  const pub = await page.context().newPage();
  await be.install(pub);
  await pub.goto(publicUrl);
  await expect(pub.getByRole("heading", { level: 2, name: "Soft Shoulder Cut" })).toBeVisible();
  await expect(pub.getByText("sam@example.com")).toHaveCount(0);
  await shot(pub, "07-public-card");

  // Paid: seven generations + alteration on the project
  await page.getByRole("link", { name: "← Back to your looks" }).click();
  await expect(page.getByText("7 new styles and 2 alterations left this period.")).toBeVisible();
  await page.getByRole("button", { name: "Alter this" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Change something" });
  await dialog.getByRole("button", { name: "Keep enough length for a bun" }).click();
  await dialog.getByLabel(/Anything else/).fill("a little shorter at the back");
  await dialog.getByRole("button", { name: "Apply changes" }).click();
  await expect(page.getByText("Change: Keep enough length for a bun. a little shorter at the back")).toBeVisible();
  await expect(page.getByText("7 new styles and 1 alterations left this period.")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Generate another like this" }).first().click();
  await expect(page.getByRole("heading", { name: /Textured Crop/ })).toBeVisible();
  await expect(page.getByText("6 new styles and 1 alterations left this period.")).toBeVisible({ timeout: 30_000 });
  await shot(page, "08-results-paid");

  // Revoke sharing → public link stops working
  await page.goto(cardUrl);
  await page.getByRole("button", { name: "Stop sharing" }).click();
  await expect(page.getByText("Sharing turned off")).toBeVisible();
  await pub.reload();
  await expect(pub.getByText("isn't valid or is no longer shared")).toBeVisible();

  // Account → cancel subscription
  await page.goto("/account");
  await expect(page.getByText("Plus — active")).toBeVisible();
  await page.getByRole("button", { name: "Cancel subscription" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel subscription" }).click();
  await expect(page.getByText("Your subscription is cancelled.")).toBeVisible();
  await shot(page, "09-account-cancelled");

  expect(errors).toEqual([]);
  for (const e of ["landing_viewed", "upload_started", "email_submitted", "email_verified", "hairstyle_selected", "checkout_started", "subscription_completed", "qr_generated", "download", "email_share", "qr_viewed", "alteration_requested", "subscription_cancelled"]) {
    expect(be.events, `analytics event ${e}`).toContain(e);
  }
});

test("unsuitable photo is rejected with a clear next step", async ({ page }) => {
  const be = new MockBackend();
  await be.install(page);
  await uploadAndDescribe(page, "TEST_MULTIPLE");
  await expect(page.getByRole("heading", { name: "Let's try a different photo." })).toBeVisible();
  await expect(page.getByText("more than one person")).toBeVisible();
  await expect(page.getByRole("link", { name: "Upload another photo" })).toBeVisible();
});

test("expired or unknown public card link shows a friendly message", async ({ page }) => {
  const be = new MockBackend();
  await be.install(page);
  await page.goto("/style/doesnotexist_doesnotexist_doesnotexist");
  await expect(page.getByText("isn't valid or is no longer shared")).toBeVisible();
});
