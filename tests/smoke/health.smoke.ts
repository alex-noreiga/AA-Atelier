import { test, expect } from "@playwright/test";

// The cheapest possible liveness signal: the Express app answers `/api/health`.
// A failure here means the serverless function is down or the deploy is broken,
// independent of any page. Uses the API request context (no browser) against
// the configured baseURL.

// How old a deployed build may be before it's suspicious. Generous — a live,
// actively-deployed site rebuilds far more often; a `buildTime` past this means
// a stale serverless function is serving a months-old bundle.
const MAX_BUILD_AGE_DAYS = 60;

test.describe("Production smoke: API health", () => {
  test("GET /api/health returns ok", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);

    const body = (await res.json()) as {
      status: string;
      commit?: string;
      buildTime?: string;
    };
    expect(body).toMatchObject({ status: "ok" });

    // Deploy-freshness signal — only asserted when the deploy exposes it, so an
    // older deploy without these fields still passes (backward-compatible).
    if (body.buildTime) {
      const built = new Date(body.buildTime);
      expect(Number.isNaN(built.getTime())).toBe(false);
      const ageDays = (Date.now() - built.getTime()) / 86_400_000;
      expect(
        ageDays,
        `deployed build is ${Math.floor(ageDays)} days old ` +
          `(built ${body.buildTime}) — a stale deploy may be live.`,
      ).toBeLessThan(MAX_BUILD_AGE_DAYS);
    }
  });
});
