import { defineConfig, devices } from "@playwright/test";

// E2E runs the real frontend against a stateful mock backend (tests/e2e/mockBackend.ts)
// that implements the Edge Function / PostgREST / Auth / Storage contracts.
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5174",
    launchOptions: process.env.PW_CHROMIUM === "" ? {} : { executablePath: process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium" },
    trace: "retain-on-failure",
  },
  projects: [
    { name: "mobile", use: { ...devices["Pixel 7"], browserName: "chromium", locale: "en-GB", timezoneId: "Europe/London" } },
  ],
  webServer: {
    command: "npx vite --port 5174 --strictPort",
    url: "http://localhost:5174",
    reuseExistingServer: false,
    env: { VITE_SUPABASE_URL: "http://127.0.0.1:59999", VITE_SUPABASE_ANON_KEY: "test-anon-key", VITE_APP_NAME: "CutCard" },
  },
});
