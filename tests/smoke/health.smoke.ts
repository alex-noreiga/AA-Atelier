import { test, expect } from "@playwright/test";

// The cheapest possible liveness signal: the Express app answers `/api/health`.
// A failure here means the serverless function is down or the deploy is broken,
// independent of any page. Uses the API request context (no browser) against
// the configured baseURL.

test.describe("Production smoke: API health", () => {
  test("GET /api/health returns ok", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: "ok" });
  });
});
