import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Stripe client (signature verification) and the recording services so
// the webhook route runs end-to-end without Stripe/Notion.
vi.mock("../../src/lib/stripe/client.js", () => ({ getStripeClient: vi.fn() }));
vi.mock("../../src/services/checkout.service.js", () => ({
  createCheckoutSession: vi.fn(),
  getCheckoutSession: vi.fn(),
  recordPaidOrder: vi.fn(),
}));
vi.mock("../../src/services/invoice.service.js", () => ({
  recordPayment: vi.fn(),
  CUSTOM_PAYMENT_KIND: "custom_payment",
}));

import request from "supertest";
import type Stripe from "stripe";
import app from "../../src/app.js";
import { getStripeClient } from "../../src/lib/stripe/client.js";
import { recordPaidOrder } from "../../src/services/checkout.service.js";
import { recordPayment } from "../../src/services/invoice.service.js";

const mockGetStripe = vi.mocked(getStripeClient);
const mockRecord = vi.mocked(recordPaidOrder);
const mockRecordPayment = vi.mocked(recordPayment);

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
  it("verifies the signature and records a completed shop checkout", async () => {
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
    expect(mockRecordPayment).not.toHaveBeenCalled();
  });

  it("routes a custom_payment session to the payment recorder, not the shop recorder", async () => {
    const sessionObject = {
      id: "cs_pay",
      metadata: { kind: "custom_payment", stage: "first_deposit" },
    };
    stubConstructEvent(
      () =>
        ({
          type: "checkout.session.completed",
          data: { object: sessionObject },
        }) as unknown as Stripe.Event,
    );
    mockRecordPayment.mockResolvedValue();

    const res = await request(app)
      .post("/api/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("stripe-signature", "t=1,v1=abc")
      .send(JSON.stringify({ id: "evt_pay" }));

    expect(res.status).toBe(200);
    expect(mockRecordPayment).toHaveBeenCalledWith(sessionObject);
    expect(mockRecord).not.toHaveBeenCalled();
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

  it("returns 400 when the webhook secret is not configured", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    // The guard short-circuits before any signature verification, so the Stripe
    // client is never consulted.
    const constructEvent = stubConstructEvent(
      () =>
        ({
          type: "checkout.session.completed",
          data: { object: { id: "cs_1" } },
        }) as unknown as Stripe.Event,
    );

    const res = await request(app)
      .post("/api/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("stripe-signature", "t=1,v1=abc")
      .send(JSON.stringify({ id: "evt_1" }));

    expect(res.status).toBe(400);
    expect(constructEvent).not.toHaveBeenCalled();
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("returns 500 so Stripe retries when recording a shop order throws", async () => {
    const sessionObject = { id: "cs_boom" };
    stubConstructEvent(
      () =>
        ({
          type: "checkout.session.completed",
          data: { object: sessionObject },
        }) as unknown as Stripe.Event,
    );
    // The recorder failing (e.g. a Notion outage) must not be swallowed: Stripe
    // delivers at-least-once and retries on any non-2xx, and recordPaidOrder is
    // idempotent, so a 500 here is what makes the retry safe.
    mockRecord.mockRejectedValue(new Error("Notion is down"));

    const res = await request(app)
      .post("/api/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("stripe-signature", "t=1,v1=abc")
      .send(JSON.stringify({ id: "evt_boom" }));

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ received: false });
  });

  it("returns 500 when recording a custom payment throws", async () => {
    const sessionObject = {
      id: "cs_pay_boom",
      metadata: { kind: "custom_payment", stage: "balance" },
    };
    stubConstructEvent(
      () =>
        ({
          type: "checkout.session.completed",
          data: { object: sessionObject },
        }) as unknown as Stripe.Event,
    );
    mockRecordPayment.mockRejectedValue(new Error("Notion is down"));

    const res = await request(app)
      .post("/api/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("stripe-signature", "t=1,v1=abc")
      .send(JSON.stringify({ id: "evt_pay_boom" }));

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ received: false });
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
