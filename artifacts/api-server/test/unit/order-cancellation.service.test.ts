import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the order/shop lookups + cancel writers, the invoice read, and the email
// transport. A fake Stripe is injected per test (never the real client).
vi.mock("../../src/lib/notion/orders.repository.js", () => ({
  findOrderForCancellation: vi.fn(),
  setOrderCancelled: vi.fn(),
}));
vi.mock("../../src/lib/notion/shop-orders.repository.js", () => ({
  findShopOrderForCancellation: vi.fn(),
  setShopOrderCancelled: vi.fn(),
}));
vi.mock("../../src/lib/notion/invoice.repository.js", () => ({
  findInvoice: vi.fn(),
}));
vi.mock("../../src/lib/resend/send.js", () => ({
  sendEmailBestEffort: vi.fn(),
}));
// The payment ledger records each issued refund as a negative movement. Its own
// mapping is covered in payment-ledger.service.test.ts; mock it here and assert
// only that each refund is attributed to the right order (and stage).
vi.mock("../../src/services/payment-ledger.service.js", () => ({
  recordStripeRefund: vi.fn(),
}));

import type Stripe from "stripe";
import { processCancellation } from "../../src/services/order-cancellation.service.js";
import {
  findOrderForCancellation,
  setOrderCancelled,
} from "../../src/lib/notion/orders.repository.js";
import {
  findShopOrderForCancellation,
  setShopOrderCancelled,
} from "../../src/lib/notion/shop-orders.repository.js";
import { findInvoice } from "../../src/lib/notion/invoice.repository.js";
import { sendEmailBestEffort } from "../../src/lib/resend/send.js";
import { recordStripeRefund } from "../../src/services/payment-ledger.service.js";
import { NotFoundError } from "../../src/lib/errors.js";
import { logger } from "../../src/lib/logger.js";

const mockFindOrder = vi.mocked(findOrderForCancellation);
const mockSetCancelled = vi.mocked(setOrderCancelled);
const mockFindShop = vi.mocked(findShopOrderForCancellation);
const mockSetShopCancelled = vi.mocked(setShopOrderCancelled);
const mockFindInvoice = vi.mocked(findInvoice);
const mockSend = vi.mocked(sendEmailBestEffort);

interface FakeStripeConfig {
  /** sessionId → payment_intent id (null = $0 session), or "throw" to fail retrieve. */
  sessions?: Record<string, string | null | "throw">;
  /** payment_intents that already have a refund (refunds.list returns one). */
  preRefunded?: string[];
  /** payment_intent → refund amount in cents (default 5000 = $50). */
  amounts?: Record<string, number>;
}

function fakeStripe(config: FakeStripeConfig = {}) {
  const { sessions = {}, preRefunded = [], amounts = {} } = config;
  const create = vi.fn(
    async (
      { payment_intent }: { payment_intent: string },
      _opts?: { idempotencyKey?: string },
    ) => ({
      id: `re_${payment_intent}`,
      amount: amounts[payment_intent] ?? 5000,
    }),
  );
  const list = vi.fn(
    async ({ payment_intent }: { payment_intent: string }) => ({
      data: preRefunded.includes(payment_intent) ? [{ id: "re_existing" }] : [],
    }),
  );
  const retrieve = vi.fn(async (id: string) => {
    const pi = sessions[id];
    if (pi === "throw") throw new Error("No such checkout session");
    return { id, payment_intent: pi ?? null };
  });
  return {
    stripe: {
      checkout: { sessions: { retrieve } },
      refunds: { list, create },
    } as unknown as Stripe,
    create,
    list,
    retrieve,
  };
}

function customOrder(overrides: Record<string, unknown> = {}) {
  return {
    pageId: "order-page",
    orderNumber: "ORD-1",
    orderName: "Ada – Custom Dress",
    email: "ada@example.com",
    invoicePageId: "invoice-page",
    cancelled: false,
    ...overrides,
  };
}

function invoice(overrides: Record<string, unknown> = {}) {
  return {
    pageId: "invoice-page",
    invoiceId: "ORD-1",
    ready: true,
    balancePaid: false,
    deposits: [],
    ...overrides,
  } as any;
}

beforeEach(() => {
  vi.spyOn(logger, "error").mockImplementation(() => logger);
});

afterEach(() => {
  delete process.env.RESEND_FROM_EMAIL;
});

describe("processCancellation — custom order", () => {
  it("refunds every paid deposit + balance and marks the order cancelled", async () => {
    mockFindOrder.mockResolvedValue(customOrder());
    mockFindInvoice.mockResolvedValue(
      invoice({
        balancePaid: true,
        balanceSessionId: "cs_bal",
        deposits: [
          {
            stage: "first_deposit",
            label: "First deposit",
            amount: 100,
            paid: true,
            sessionId: "cs_d1",
          },
          {
            stage: "second_deposit",
            label: "Second deposit",
            amount: 100,
            paid: true,
            sessionId: "cs_d2",
          },
        ],
      }),
    );
    const { stripe, create } = fakeStripe({
      sessions: { cs_d1: "pi_1", cs_d2: "pi_2", cs_bal: "pi_bal" },
      amounts: { pi_1: 10000, pi_2: 10000, pi_bal: 30000 },
    });

    const result = await processCancellation("ORD-1", stripe);

    expect(create).toHaveBeenCalledTimes(3);
    expect(result.refundsIssued).toBe(3);
    expect(result.totalRefunded).toBe(500);
    expect(result.cancelledNow).toBe(true);
    expect(result.hadError).toBe(false);
    expect(mockSetCancelled).toHaveBeenCalledWith("order-page");
    expect(mockSend).toHaveBeenCalledOnce();
  });

  it("passes an idempotency key so concurrent presses can't double-refund", async () => {
    mockFindOrder.mockResolvedValue(
      customOrder({ invoicePageId: "invoice-page" }),
    );
    mockFindInvoice.mockResolvedValue(
      invoice({
        deposits: [
          {
            stage: "first_deposit",
            label: "First deposit",
            amount: 100,
            paid: true,
            sessionId: "cs_d1",
          },
        ],
      }),
    );
    const { stripe, create } = fakeStripe({ sessions: { cs_d1: "pi_1" } });

    await processCancellation("ORD-1", stripe);

    expect(create.mock.calls[0][1]).toEqual({ idempotencyKey: "refund_pi_1" });
  });

  it("skips a payment that already has a refund (re-press) and issues none", async () => {
    mockFindOrder.mockResolvedValue(customOrder({ cancelled: true }));
    mockFindInvoice.mockResolvedValue(
      invoice({
        deposits: [
          {
            stage: "first_deposit",
            label: "First deposit",
            amount: 100,
            paid: true,
            sessionId: "cs_d1",
          },
        ],
      }),
    );
    const { stripe, create } = fakeStripe({
      sessions: { cs_d1: "pi_1" },
      preRefunded: ["pi_1"],
    });

    const result = await processCancellation("ORD-1", stripe);

    expect(create).not.toHaveBeenCalled();
    expect(result.refundsIssued).toBe(0);
    expect(result.alreadyCancelled).toBe(true);
    expect(result.cancelledNow).toBe(false);
    // Already cancelled + nothing new refunded ⇒ no re-mark, no email.
    expect(mockSetCancelled).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("skips a $0 / null-payment_intent session without erroring", async () => {
    mockFindOrder.mockResolvedValue(customOrder());
    mockFindInvoice.mockResolvedValue(
      invoice({
        deposits: [
          {
            stage: "first_deposit",
            label: "First deposit",
            amount: 0,
            paid: true,
            sessionId: "cs_free",
          },
        ],
      }),
    );
    const { stripe, create } = fakeStripe({ sessions: { cs_free: null } });

    const result = await processCancellation("ORD-1", stripe);

    expect(create).not.toHaveBeenCalled();
    expect(result.refundsIssued).toBe(0);
    expect(result.hadError).toBe(false);
    // Nothing to refund but the order is still cancelled (a valid cancellation).
    expect(result.cancelledNow).toBe(true);
    expect(mockSetCancelled).toHaveBeenCalledOnce();
    expect(result.skipped.some((s) => s.includes("no payment"))).toBe(true);
  });

  it("surfaces a paid stage with no recorded session id as a manual refund", async () => {
    mockFindOrder.mockResolvedValue(customOrder());
    mockFindInvoice.mockResolvedValue(
      invoice({
        deposits: [
          {
            stage: "first_deposit",
            label: "First deposit",
            amount: 100,
            paid: true,
          },
        ],
      }),
    );
    const { stripe, create } = fakeStripe();

    const result = await processCancellation("ORD-1", stripe);

    expect(create).not.toHaveBeenCalled();
    expect(result.hadError).toBe(false);
    expect(result.cancelledNow).toBe(true);
    expect(result.skipped.some((s) => s.includes("refund manually"))).toBe(
      true,
    );
  });

  it("leaves the order uncancelled on a refund error so a re-press retries", async () => {
    mockFindOrder.mockResolvedValue(customOrder());
    mockFindInvoice.mockResolvedValue(
      invoice({
        balancePaid: true,
        balanceSessionId: "cs_bad",
        deposits: [
          {
            stage: "first_deposit",
            label: "First deposit",
            amount: 100,
            paid: true,
            sessionId: "cs_d1",
          },
        ],
      }),
    );
    // The deposit refunds fine, the balance session retrieve throws.
    const { stripe, create } = fakeStripe({
      sessions: { cs_d1: "pi_1", cs_bad: "throw" },
    });

    const result = await processCancellation("ORD-1", stripe);

    expect(create).toHaveBeenCalledTimes(1); // the deposit still refunded
    expect(result.hadError).toBe(true);
    expect(result.cancelledNow).toBe(false);
    expect(mockSetCancelled).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
    expect(result.skipped.some((s) => s.includes("refund failed"))).toBe(true);
  });

  it("cancels a custom order with no invoice (nothing to refund)", async () => {
    mockFindOrder.mockResolvedValue(customOrder({ invoicePageId: undefined }));
    const { stripe, create } = fakeStripe();

    const result = await processCancellation("ORD-1", stripe);

    expect(mockFindInvoice).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(result.refundsIssued).toBe(0);
    expect(result.cancelledNow).toBe(true);
    expect(mockSetCancelled).toHaveBeenCalledOnce();
    // A refund confirmation still goes out (with $0 refunded).
    expect(mockSend).toHaveBeenCalledOnce();
  });

  it("throws NotFoundError when the order is unknown", async () => {
    mockFindOrder.mockResolvedValue(null);
    const { stripe } = fakeStripe();
    await expect(
      processCancellation("ORD-NOPE", stripe),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("processCancellation — shop order", () => {
  it("refunds the single checkout session and marks the shop order cancelled", async () => {
    mockFindShop.mockResolvedValue({
      pageId: "shop-page",
      orderNumber: "SHP-1",
      email: "ada@example.com",
      sessionId: "cs_shop",
      status: "Payment Confirmed",
      cancelled: false,
      refundedAmount: 0,
    });
    const { stripe, create } = fakeStripe({
      sessions: { cs_shop: "pi_shop" },
      amounts: { pi_shop: 8800 },
    });

    const result = await processCancellation("SHP-1", stripe);

    expect(create).toHaveBeenCalledOnce();
    expect(result.orderType).toBe("shop");
    expect(result.refundsIssued).toBe(1);
    expect(result.totalRefunded).toBe(88);
    expect(mockSetShopCancelled).toHaveBeenCalledWith("shop-page");
    // The custom lookup is never touched for an SHP- number.
    expect(mockFindOrder).not.toHaveBeenCalled();
  });

  it("throws NotFoundError when the shop order is unknown", async () => {
    mockFindShop.mockResolvedValue(null);
    const { stripe } = fakeStripe();
    await expect(
      processCancellation("SHP-NOPE", stripe),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("the payment ledger", () => {
  it("records each refunded stage against its own order and stage", async () => {
    // Until this existed a cancellation moved the money through Stripe and left
    // the invoice's `… Paid` checkbox ticked, so the studio figures went on
    // counting a refunded order as collected revenue.
    mockFindOrder.mockResolvedValue(customOrder());
    mockFindInvoice.mockResolvedValue(
      invoice({
        balancePaid: true,
        balanceSessionId: "cs_bal",
        deposits: [
          {
            stage: "first_deposit",
            label: "First deposit",
            amount: 100,
            paid: true,
            sessionId: "cs_d1",
          },
        ],
      }),
    );
    const { stripe } = fakeStripe({
      sessions: { cs_d1: "pi_1", cs_bal: "pi_bal" },
      amounts: { pi_1: 10000, pi_bal: 30000 },
    });

    await processCancellation("ORD-1", stripe);

    const calls = vi.mocked(recordStripeRefund).mock.calls.map((c) => c[0]);
    expect(calls).toEqual([
      expect.objectContaining({
        orderNumber: "ORD-1",
        orderKind: "custom",
        stage: "first_deposit",
      }),
      expect.objectContaining({
        orderNumber: "ORD-1",
        orderKind: "custom",
        stage: "balance",
      }),
    ]);
  });

  it("records a shop refund with no stage", async () => {
    mockFindShop.mockResolvedValue({
      pageId: "shop-page",
      orderNumber: "SHP-1",
      email: "ada@example.com",
      sessionId: "cs_shop",
      status: "Payment Confirmed",
      cancelled: false,
      refundedAmount: 0,
    });
    const { stripe } = fakeStripe({
      sessions: { cs_shop: "pi_shop" },
      amounts: { pi_shop: 8800 },
    });

    await processCancellation("SHP-1", stripe);

    const entry = vi.mocked(recordStripeRefund).mock.calls[0]?.[0];
    expect(entry).toEqual(
      expect.objectContaining({ orderNumber: "SHP-1", orderKind: "shop" }),
    );
    expect(entry).not.toHaveProperty("stage");
  });

  it("does not record anything when there was nothing to refund", async () => {
    mockFindShop.mockResolvedValue({
      pageId: "shop-page",
      orderNumber: "SHP-2",
      email: "ada@example.com",
      sessionId: "",
      status: "Payment Confirmed",
      cancelled: false,
      refundedAmount: 0,
    });
    const { stripe } = fakeStripe({});

    await processCancellation("SHP-2", stripe);

    expect(vi.mocked(recordStripeRefund)).not.toHaveBeenCalled();
  });
});
