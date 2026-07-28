import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../../src/app.js";

// The account auth routes carry a rate limiter (30 requests / 15 min / IP). Its
// in-memory store is per module instance, so this file — which owns its own app
// import — can exhaust the window in isolation without affecting other suites.
// /account/logout is used because it has no external dependencies to mock.
describe("account auth rate limiting", () => {
  it("returns 429 once the per-window request limit is exceeded", async () => {
    for (let i = 0; i < 30; i++) {
      const res = await request(app).post("/api/account/logout");
      expect(res.status).toBe(200);
    }

    const blocked = await request(app).post("/api/account/logout");
    expect(blocked.status).toBe(429);
    expect(blocked.body).toHaveProperty("error");
  });
});
