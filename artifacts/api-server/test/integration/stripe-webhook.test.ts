import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Stripe client (signature verification) and the checkout service
// (order recording) so the webhook route runs end-to-end without Stripe/Notion.
vi.mock("../../src/lib/stripe/client.js", () => ({ getStripeClient: vi.fn() }));
vi.mock("../../src/services/checkout.service.js", () => ({
  createCheckoutSession: vi.fn(),
  getCheckoutSession: vi.fn(),
  recordPaidOrder: vi.fn(),
}));

import request from "supertest";
import type Stripe from "stripe";
import app from "../../src/app.js";
import { getStripeClient } from "../../src/lib/stripe/client.js";
import { recordPaidOrder } from "../../src/services/checkout.service.js";

const mockGetStripe = vi.mocked(getStripeClient);
const mockRecord = vi.mocked(recordPaidOrder);

function stubConstructEvent(impl: () => Stripe.Event) {
  const constructEvent = vi.fn().mockImplementation(impl);
  mockGetStripe.mockReturnValue({
    webhooks: { constructEvent },
  } as unknown as Stripe);
  return constructEvent;
}

beforeEach(() => {
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
});

describe("POST /api/webhooks/stripe", () => {
  it("verifies the signature and records a completed checkout", async () => {
    const sessionObject = { id: "cs_1" };
    stubConstructEvent(
      () =>
        ({
          type: "checkout.session.completed",
          data: { object: sessionObject },
        }) as unknown as Stripe.Event,
    );
    mockRecord.mockResolvedValue();

    const res = await request(app)
      .post("/api/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("stripe-signature", "t=1,v1=abc")
      .send(JSON.stringify({ id: "evt_1" }));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
    expect(mockRecord).toHaveBeenCalledWith(sessionObject);
  });

  it("returns 400 when signature verification fails and records nothing", async () => {
    stubConstructEvent(() => {
      throw new Error("bad signature");
    });

    const res = await request(app)
      .post("/api/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("stripe-signature", "t=1,v1=wrong")
      .send(JSON.stringify({ id: "evt_1" }));

    expect(res.status).toBe(400);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("returns 400 when the signature header is missing", async () => {
    const res = await request(app)
      .post("/api/webhooks/stripe")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ id: "evt_1" }));

    expect(res.status).toBe(400);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("ignores unrelated event types with a 200", async () => {
    stubConstructEvent(
      () =>
        ({
          type: "payment_intent.created",
          data: { object: {} },
        }) as unknown as Stripe.Event,
    );

    const res = await request(app)
      .post("/api/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("stripe-signature", "t=1,v1=abc")
      .send(JSON.stringify({ id: "evt_2" }));

    expect(res.status).toBe(200);
    expect(mockRecord).not.toHaveBeenCalled();
  });
});
