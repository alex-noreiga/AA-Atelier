import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/lib/db/abandoned-carts.repository.js", () => ({
  saveAbandonedCart: vi.fn(),
  findDueAbandonedCarts: vi.fn(),
  claimAbandonedCart: vi.fn(),
  clearAbandonedCart: vi.fn(),
  deleteExpiredAbandonedCarts: vi.fn(),
}));

import request from "supertest";
import { GENERIC_ERROR } from "@workspace/test-fixtures";
import app from "../../src/app.js";
import { saveAbandonedCart } from "../../src/lib/db/abandoned-carts.repository.js";

const mockSave = vi.mocked(saveAbandonedCart);

function reminderBody(overrides: Record<string, unknown> = {}) {
  return {
    email: "Skater@Example.com",
    items: [
      {
        variantId: "v1",
        name: "Bow Fleece Soaker",
        size: "S",
        quantity: 2,
        price: 24,
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  // The capture stores only when Postgres is configured; these tests exercise
  // the configured path (the repository itself is mocked, so nothing connects).
  process.env.POSTGRES_URL = "postgres://test";
});

afterEach(() => {
  delete process.env.POSTGRES_URL;
});

describe("POST /api/cart-reminders", () => {
  it("returns 201 { success: true } and stores the normalized cart", async () => {
    mockSave.mockResolvedValue(undefined);

    const res = await request(app)
      .post("/api/cart-reminders")
      .send(reminderBody());

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true });
    expect(mockSave).toHaveBeenCalledOnce();
    expect(mockSave.mock.calls[0][0]).toBe("skater@example.com");
    expect(mockSave.mock.calls[0][1]).toEqual(reminderBody().items);
  });

  it("accepts without storing when Postgres isn't configured", async () => {
    delete process.env.POSTGRES_URL;

    const res = await request(app)
      .post("/api/cart-reminders")
      .send(reminderBody());

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true });
    expect(mockSave).not.toHaveBeenCalled();
  });

  // The anti-spam contract: a flagged submit gets the exact success shape and
  // writes nothing, so a bot never learns it was caught. (The timing signal
  // shares the same middleware and is unit-tested in spam-filter.test.ts.)
  it("silently drops a submission with the honeypot filled", async () => {
    const res = await request(app)
      .post("/api/cart-reminders")
      .send(reminderBody({ website: "https://spam.example" }));

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true });
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed email and does not store", async () => {
    const res = await request(app)
      .post("/api/cart-reminders")
      .send(reminderBody({ email: "not-an-email" }));

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(mockSave).not.toHaveBeenCalled();
  });

  // NOTE: this file must stay at ≤5 requests — the shared submissionRateLimiter
  // allows 5 per IP per window, and the limiter's own behavior has its own suite
  // (submission-rate-limit.routes.test.ts).
  it("returns 500 with a generic message when the store throws", async () => {
    mockSave.mockRejectedValue(new Error("connection refused"));

    const res = await request(app)
      .post("/api/cart-reminders")
      .send(reminderBody());

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: GENERIC_ERROR });
  });
});
