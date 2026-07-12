import { defineConfig, devices } from "@playwright/test";

const PORT = process.env.PORT ?? "3001";
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

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
    launchOptions: {
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
        "/run/current-system/sw/bin/chromium",
    },
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
