import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

// Production smoke tests — a separate, deliberately non-mocking Playwright
// project that drives the REAL deployed site to catch production breakage
// (Notion / Google / Vercel outages, a bad deploy, a broken build) that the
// mocked `e2e/` suite can't see. Run weekly by `.github/workflows/smoke.yml`.
//
// Two hard rules distinguish this from `playwright.config.ts`:
//  1. It NEVER intercepts `/api/*` — every request goes to the live backend, so
//     a green run means the real read paths (products, order lookup, the
//     appointment catalog, the health check) actually work end to end. It does
//     NOT reuse `e2e/support/test.ts`, whose fixture fails any unmocked call.
//  2. Every spec is READ-ONLY. Nothing here creates an order, a checkout, a
//     booking, a contact message, or sends an email — the weekly monitor must
//     be safe to run against production forever.
//
// The target is set by PLAYWRIGHT_BASE_URL (defaulting to the canonical apex
// domain) so the same suite can be pointed at a Vercel preview by overriding it.
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "https://a3iceanddance.com";

// Same browser-resolution ladder as the e2e config: an explicit path, then the
// maintainer's NixOS system Chromium, otherwise Playwright's managed browser.
const NIX_CHROMIUM = "/run/current-system/sw/bin/chromium";
const chromiumPath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
  (existsSync(NIX_CHROMIUM) ? NIX_CHROMIUM : undefined);

export default defineConfig({
  testDir: "./smoke",
  // Only `*.smoke.ts` files, so the mocked `e2e/` suite (default `.spec`/`.test`
  // match) and Vitest (`.test.ts`) can never pick these up, and vice versa —
  // the extension tracks the runner, same convention as the rest of the repo.
  testMatch: "**/*.smoke.ts",
  fullyParallel: true,
  // A production monitor must not raise false alarms on a transient network
  // blip, so retry generously even outside CI; a real outage still fails all
  // attempts. `forbidOnly` guards against a stray `test.only` reaching the
  // scheduled run.
  retries: 2,
  forbidOnly: !!process.env.CI,
  // Real backends (Notion, Google free/busy) are slower than a local mock.
  timeout: 60_000,
  reporter: process.env.CI
    ? [["list"], ["html", { outputFolder: "smoke-report", open: "never" }]]
    : "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    launchOptions: chromiumPath ? { executablePath: chromiumPath } : {},
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
