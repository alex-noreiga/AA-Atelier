import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

const PORT = process.env.PORT ?? "3001";
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

// Prefer an explicitly-provided browser, then the NixOS system Chromium (the
// maintainer's local/remote env), and otherwise fall back to Playwright's own
// managed browser (e.g. `playwright install chromium` in CI) by leaving it
// unset. Forcing a nonexistent path would break every environment but the one
// it was hardcoded for.
const NIX_CHROMIUM = "/run/current-system/sw/bin/chromium";
const chromiumPath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
  (existsSync(NIX_CHROMIUM) ? NIX_CHROMIUM : undefined);

// When PLAYWRIGHT_BASE_URL is set we assume the app is already being served
// (CI against a deployment, or a manually-run `pnpm dev`). Otherwise Playwright
// starts the frontend itself. The mocked specs intercept every `/api/*` call in
// the browser, so only the frontend is required — no api-server, no Notion.
const useOwnServer = !process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 1,
  timeout: 30_000,
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    launchOptions: chromiumPath ? { executablePath: chromiumPath } : {},
  },
  webServer: useOwnServer
    ? {
        command: "pnpm --filter @workspace/order-status run dev",
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: { PORT, BASE_PATH: "/" },
      }
    : undefined,
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
