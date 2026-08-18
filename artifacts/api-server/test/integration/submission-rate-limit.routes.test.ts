import { describe, it, expect, vi } from "vitest";

// The public submission forms (contact/notify/newsletter) share one rate
// limiter (5 requests / 10 min / IP). Its in-memory store is per module
// instance, so this file — which owns its own app import — can exhaust the
// window in isolation without affecting other suites. /contact is used with the
// Notion write mocked so no external dependency is touched.
vi.mock("../../src/lib/notion/contact.repository.js", () => ({
  createContactMessage: vi.fn().mockResolvedValue(undefined),
}));

import request from "supertest";
import { contactInput } from "@workspace/test-fixtures";
import app from "../../src/app.js";

describe("public submission rate limiting", () => {
  it("returns 429 once the per-window request limit is exceeded", async () => {
    // A clean body (no honeypot, no timing) passes the spam filter, so each
    // request reaches the handler and counts against the limit.
    for (let i = 0; i < 5; i++) {
      const res = await request(app).post("/api/contact").send(contactInput());
      expect(res.status).toBe(201);
    }

    const blocked = await request(app)
      .post("/api/contact")
      .send(contactInput());
    expect(blocked.status).toBe(429);
    expect(blocked.body).toHaveProperty("error");
  });
});
