import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../../src/app.js";

// The account overview route carries a rate limiter (30 requests / 15 min / IP)
// as a brake on its authorization surface. Its in-memory store is per module
// instance, so this file — which owns its own app import — can exhaust the window
// in isolation without affecting other suites. No auth token is sent, so each
// allowed request 401s (the limiter runs before the auth gate); once the window
// is exhausted the limiter short-circuits with a 429.
describe("account overview rate limiting", () => {
  it("returns 429 once the per-window request limit is exceeded", async () => {
    for (let i = 0; i < 30; i++) {
      const res = await request(app).get("/api/account/overview");
      expect(res.status).toBe(401);
    }

    const blocked = await request(app).get("/api/account/overview");
    expect(blocked.status).toBe(429);
    expect(blocked.body).toHaveProperty("error");
  });
});
