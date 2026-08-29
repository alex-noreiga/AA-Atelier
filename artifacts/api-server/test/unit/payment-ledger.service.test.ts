// The best-effort layer over the payment ledger.
//
// Two properties matter more than the mapping: it must be INERT when Postgres
// isn't configured (every other Postgres caller degrades, and a studio without
// one still has to be able to take money), and it must NEVER THROW — every
// caller is either the Stripe webhook, where a throw makes Stripe redeliver into
// a dedupe guard, or a refund that has already moved real money.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type Stripe from "stripe";

const recordPaymentEntry = vi.fn();
vi.mock("../../src/lib/db/payments.repository.js", () => ({
  recordPaymentEntry: (...args: unknown[]) => recordPaymentEntry(...args),
}));

const { recordStripeCharge, recordStripeRefund } =
  await import("../../src/services/payment-ledger.service.js");

/** 2026-08-14T15:04:05Z and 2026-08-14T15:09:05Z, as Stripe unix seconds. */
const SESSION_CREATED = 1786633445;
const INTENT_CREATED = 1786633745;

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: "cs_test_1",
    created: SESSION_CREATED,
    amount_total: 25000,
    currency: "usd",
    payment_intent: "pi_1",
    ...overrides,
  } as unknown as Stripe.Checkout.Session;
}

function refund(overrides: Record<string, unknown> = {}) {
  return {
    id: "re_1",
    created: SESSION_CREATED,
    amount: 4000,
    currency: "usd",
    payment_intent: "pi_1",
    ...overrides,
  } as unknown as Stripe.Refund;
}

beforeEach(() => {
  process.env.POSTGRES_URL = "postgres://localhost/test";
  recordPaymentEntry.mockResolvedValue(true);
});

afterEach(() => {
  delete process.env.POSTGRES_URL;
});

describe("recordStripeCharge", () => {
  it("records the session total, id and intent against the order", async () => {
    await recordStripeCharge({
      orderNumber: "ORD-000002",
      orderKind: "custom",
      stage: "first_deposit",
      session: session(),
    });

    expect(recordPaymentEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        orderNumber: "ORD-000002",
        orderKind: "custom",
        stage: "first_deposit",
        kind: "charge",
        amountCents: 25000,
        currency: "usd",
        method: "stripe",
        externalId: "cs_test_1",
        paymentIntentId: "pi_1",
      }),
    );
  });

  it("dates the charge from the session when the intent isn't expanded", async () => {
    await recordStripeCharge({
      orderNumber: "ORD-000002",
      orderKind: "custom",
      session: session(),
    });

    const entry = recordPaymentEntry.mock.calls[0]?.[0];
    expect(entry.paidAt.toISOString()).toBe(
      new Date(SESSION_CREATED * 1000).toISOString(),
    );
  });

  it("prefers the expanded intent's instant — the charge, not the checkout", async () => {
    // The shop path expands `payment_intent` precisely for this: the two differ
    // by the minutes a customer spends typing a card, which decides the month
    // for an order paid either side of midnight on the last of it.
    await recordStripeCharge({
      orderNumber: "SHP-1",
      orderKind: "shop",
      session: session({
        payment_intent: { id: "pi_1", created: INTENT_CREATED },
      }),
    });

    const entry = recordPaymentEntry.mock.calls[0]?.[0];
    expect(entry.paidAt.toISOString()).toBe(
      new Date(INTENT_CREATED * 1000).toISOString(),
    );
    expect(entry.paymentIntentId).toBe("pi_1");
  });

  it("omits the stage for a shop order rather than inventing one", async () => {
    await recordStripeCharge({
      orderNumber: "SHP-1",
      orderKind: "shop",
      session: session(),
    });

    expect(recordPaymentEntry.mock.calls[0]?.[0]).not.toHaveProperty("stage");
  });

  it("is inert when Postgres isn't configured", async () => {
    delete process.env.POSTGRES_URL;
    await recordStripeCharge({
      orderNumber: "ORD-000002",
      orderKind: "custom",
      session: session(),
    });

    expect(recordPaymentEntry).not.toHaveBeenCalled();
  });

  it("skips — and does not throw — a session with no order number", async () => {
    await expect(
      recordStripeCharge({
        orderNumber: "",
        orderKind: "shop",
        session: session(),
      }),
    ).resolves.toBeUndefined();

    expect(recordPaymentEntry).not.toHaveBeenCalled();
  });

  it("swallows a database failure so the webhook still succeeds", async () => {
    recordPaymentEntry.mockRejectedValue(new Error("connection refused"));

    await expect(
      recordStripeCharge({
        orderNumber: "ORD-000002",
        orderKind: "custom",
        session: session(),
      }),
    ).resolves.toBeUndefined();
  });
});

describe("recordStripeRefund", () => {
  it("records the refund's own id, so a topped-up return lands as two rows", async () => {
    await recordStripeRefund({
      orderNumber: "SHP-1",
      orderKind: "shop",
      refund: refund(),
    });

    expect(recordPaymentEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        orderNumber: "SHP-1",
        kind: "refund",
        amountCents: 4000,
        externalId: "re_1",
        paymentIntentId: "pi_1",
      }),
    );
  });

  it("dates the refund when it was issued", async () => {
    await recordStripeRefund({
      orderNumber: "SHP-1",
      orderKind: "shop",
      refund: refund(),
    });

    const entry = recordPaymentEntry.mock.calls[0]?.[0];
    expect(entry.paidAt.toISOString()).toBe(
      new Date(SESSION_CREATED * 1000).toISOString(),
    );
  });

  it("swallows a database failure so an issued refund isn't reported as failed", async () => {
    recordPaymentEntry.mockRejectedValue(new Error("connection refused"));

    await expect(
      recordStripeRefund({
        orderNumber: "SHP-1",
        orderKind: "shop",
        refund: refund(),
      }),
    ).resolves.toBeUndefined();
  });

  it("is inert when Postgres isn't configured", async () => {
    delete process.env.POSTGRES_URL;
    await recordStripeRefund({
      orderNumber: "SHP-1",
      orderKind: "shop",
      refund: refund(),
    });

    expect(recordPaymentEntry).not.toHaveBeenCalled();
  });
});
