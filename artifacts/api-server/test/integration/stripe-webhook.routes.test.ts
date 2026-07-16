import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Stripe client (signature verification) and the checkout service
// (order recording) so the webhook route runs end-to-end without Stripe/Notion.
vi.mock("../../src/lib/stripe/client.js", () => ({ getStripeClient: vi.fn() }));
vi.mock("../../src/services/checkout.service.js", () => ({
  createCheckoutSession: vi.fn(),
  getCheckoutSession: vi.fn(),
  recordPaidOrder: vi.fn(),
}));
vi.mock("../../src/services/deposit.service.js", () => ({
  recordDepositPayment: vi.fn(),
  DEPOSIT_SESSION_KIND: "deposit",
}));
vi.mock("../../src/services/invoice.service.js", () => ({
  recordInvoicePayment: vi.fn(),
  INVOICE_SESSION_KIND: "invoice",
}));

import request from "supertest";
import type Stripe from "stripe";
import app from "../../src/app.js";
import { getStripeClient } from "../../src/lib/stripe/client.js";
import { recordPaidOrder } from "../../src/services/checkout.service.js";
import { recordDepositPayment } from "../../src/services/deposit.service.js";
import { recordInvoicePayment } from "../../src/services/invoice.service.js";

const mockGetStripe = vi.mocked(getStripeClient);
const mockRecord = vi.mocked(recordPaidOrder);
const mockRecordDeposit = vi.mocked(recordDepositPayment);
const mockRecordInvoice = vi.mocked(recordInvoicePayment);

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
    expect(mockRecordDeposit).not.toHaveBeenCalled();
  });

  it("routes a deposit session to the deposit recorder, not the shop recorder", async () => {
    const sessionObject = { id: "cs_dep", metadata: { kind: "deposit" } };
    stubConstructEvent(
      () =>
        ({
          type: "checkout.session.completed",
          data: { object: sessionObject },
        }) as unknown as Stripe.Event,
    );
    mockRecordDeposit.mockResolvedValue();

    const res = await request(app)
      .post("/api/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("stripe-signature", "t=1,v1=abc")
      .send(JSON.stringify({ id: "evt_dep" }));

    expect(res.status).toBe(200);
    expect(mockRecordDeposit).toHaveBeenCalledWith(sessionObject);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("routes an invoice session to the invoice recorder", async () => {
    const sessionObject = { id: "cs_inv", metadata: { kind: "invoice" } };
    stubConstructEvent(
      () =>
        ({
          type: "checkout.session.completed",
          data: { object: sessionObject },
        }) as unknown as Stripe.Event,
    );
    mockRecordInvoice.mockResolvedValue();

    const res = await request(app)
      .post("/api/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("stripe-signature", "t=1,v1=abc")
      .send(JSON.stringify({ id: "evt_inv" }));

    expect(res.status).toBe(200);
    expect(mockRecordInvoice).toHaveBeenCalledWith(sessionObject);
    expect(mockRecord).not.toHaveBeenCalled();
    expect(mockRecordDeposit).not.toHaveBeenCalled();
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

  it("returns 500 when recording a deposit payment throws", async () => {
    const sessionObject = { id: "cs_dep_boom", metadata: { kind: "deposit" } };
    stubConstructEvent(
      () =>
        ({
          type: "checkout.session.completed",
          data: { object: sessionObject },
        }) as unknown as Stripe.Event,
    );
    mockRecordDeposit.mockRejectedValue(new Error("Notion is down"));

    const res = await request(app)
      .post("/api/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("stripe-signature", "t=1,v1=abc")
      .send(JSON.stringify({ id: "evt_dep_boom" }));

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
