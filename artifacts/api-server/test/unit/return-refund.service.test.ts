import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the shop-order lookup + marker writer and the email transport. A fake
// Stripe is injected per test (never the real client).
vi.mock("../../src/lib/notion/shop-orders.repository.js", () => ({
  findShopOrderForCancellation: vi.fn(),
  recordShopOrderRefund: vi.fn(),
}));
vi.mock("../../src/lib/resend/send.js", () => ({
  sendEmailBestEffort: vi.fn(),
}));

import type Stripe from "stripe";
import {
  processReturnRefund,
  parseRefundTarget,
} from "../../src/services/return-refund.service.js";
import {
  findShopOrderForCancellation,
  recordShopOrderRefund,
} from "../../src/lib/notion/shop-orders.repository.js";
import { sendEmailBestEffort } from "../../src/lib/resend/send.js";
import { NotFoundError, BadRequestError } from "../../src/lib/errors.js";
import { logger } from "../../src/lib/logger.js";

const mockFindShop = vi.mocked(findShopOrderForCancellation);
const mockRecord = vi.mocked(recordShopOrderRefund);
const mockSend = vi.mocked(sendEmailBestEffort);

interface FakeStripeConfig {
  /** sessionId → payment_intent id (null = $0 session), or "throw" to fail. */
  sessions?: Record<string, string | null | "throw">;
  /** payment_intent → amount_received in cents. Default 20000 ($200). */
  captured?: Record<string, number>;
  /** payment_intent → refund amounts already on it, in cents. */
  existingRefunds?: Record<string, number[]>;
}

function fakeStripe(config: FakeStripeConfig = {}) {
  const { sessions = {}, captured = {}, existingRefunds = {} } = config;

  const retrieveSession = vi.fn(async (id: string) => {
    const pi = sessions[id];
    if (pi === "throw") throw new Error("No such checkout session");
    return { id, payment_intent: pi ?? null };
  });
  const retrieveIntent = vi.fn(async (id: string) => ({
    id,
    amount_received: captured[id] ?? 20000,
  }));
  const list = vi.fn(
    async ({ payment_intent }: { payment_intent: string }) => ({
      data: (existingRefunds[payment_intent] ?? []).map((amount, i) => ({
        id: `re_${i}`,
        amount,
      })),
    }),
  );
  const create = vi.fn(
    async (
      { payment_intent, amount }: { payment_intent: string; amount: number },
      _opts?: { idempotencyKey?: string },
    ) => ({ id: `re_new_${payment_intent}`, amount }),
  );

  return {
    stripe: {
      checkout: { sessions: { retrieve: retrieveSession } },
      paymentIntents: { retrieve: retrieveIntent },
      refunds: { list, create },
    } as unknown as Stripe,
    create,
    list,
  };
}

function shopOrder(overrides: Record<string, unknown> = {}) {
  return {
    pageId: "shop-page",
    orderNumber: "SHP-1",
    email: "ada@example.com",
    sessionId: "cs_1",
    status: "Delivered",
    cancelled: false,
    refundedAmount: 0,
    ...overrides,
  };
}

beforeEach(() => {
  mockRecord.mockResolvedValue(true);
});

describe("parseRefundTarget", () => {
  it("returns undefined for an absent or blank amount (refund in full)", () => {
    expect(parseRefundTarget(undefined)).toBeUndefined();
    expect(parseRefundTarget("")).toBeUndefined();
    expect(parseRefundTarget("   ")).toBeUndefined();
  });

  it("converts dollars to integer cents", () => {
    expect(parseRefundTarget("180")).toBe(18000);
    expect(parseRefundTarget("179.99")).toBe(17999);
    expect(parseRefundTarget(" 42.50 ")).toBe(4250);
  });

  // 0 is a real, distinct instruction (an even exchange), not "unset".
  it("treats 0 as a valid target, distinct from absent", () => {
    expect(parseRefundTarget("0")).toBe(0);
  });

  it("rejects a negative or malformed amount rather than coercing it", () => {
    expect(() => parseRefundTarget("-10")).toThrow(BadRequestError);
    expect(() => parseRefundTarget("abc")).toThrow(BadRequestError);
    expect(() => parseRefundTarget("NaN")).toThrow(BadRequestError);
  });
});

describe("processReturnRefund", () => {
  it("throws NotFoundError for an unknown order number", async () => {
    mockFindShop.mockResolvedValue(null);
    const { stripe } = fakeStripe();
    await expect(
      processReturnRefund("SHP-NOPE", undefined, stripe),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("throws NotFoundError for a blank order number without hitting Notion", async () => {
    const { stripe } = fakeStripe();
    await expect(
      processReturnRefund("   ", undefined, stripe),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(mockFindShop).not.toHaveBeenCalled();
  });

  it("refunds the full captured amount when no target is given", async () => {
    mockFindShop.mockResolvedValue(shopOrder());
    const { stripe, create } = fakeStripe({
      sessions: { cs_1: "pi_1" },
      captured: { pi_1: 20000 },
    });

    const result = await processReturnRefund("SHP-1", undefined, stripe);

    expect(result.status).toBe("refunded");
    expect(result.refunded).toBe(200);
    expect(result.totalRefunded).toBe(200);
    expect(result.fullyRefunded).toBe(true);
    expect(create).toHaveBeenCalledWith(
      { payment_intent: "pi_1", amount: 20000 },
      { idempotencyKey: "return_pi_1_20000" },
    );
  });

  it("refunds a partial amount for a restocking fee", async () => {
    mockFindShop.mockResolvedValue(shopOrder());
    const { stripe, create } = fakeStripe({
      sessions: { cs_1: "pi_1" },
      captured: { pi_1: 20000 },
    });

    const result = await processReturnRefund("SHP-1", 18000, stripe);

    expect(result.status).toBe("refunded");
    expect(result.refunded).toBe(180);
    expect(result.fullyRefunded).toBe(false);
    expect(create).toHaveBeenCalledWith(
      { payment_intent: "pi_1", amount: 18000 },
      expect.anything(),
    );
    expect(mockRecord).toHaveBeenCalledWith("shop-page", 180);
  });

  // The core guarantee: the amount is a TARGET TOTAL, so clicking the same
  // Notion link twice refunds once — even long after Stripe's 24h idempotency
  // key window has lapsed.
  it("is idempotent — a re-press at the same target refunds nothing more", async () => {
    mockFindShop.mockResolvedValue(shopOrder({ refundedAmount: 180 }));
    const { stripe, create } = fakeStripe({
      sessions: { cs_1: "pi_1" },
      captured: { pi_1: 20000 },
      existingRefunds: { pi_1: [18000] },
    });

    const result = await processReturnRefund("SHP-1", 18000, stripe);

    expect(result.status).toBe("already_at_target");
    expect(result.refunded).toBe(0);
    expect(result.totalRefunded).toBe(180);
    expect(create).not.toHaveBeenCalled();
  });

  it("tops a partial refund up to full, refunding only the remainder", async () => {
    mockFindShop.mockResolvedValue(shopOrder({ refundedAmount: 180 }));
    const { stripe, create } = fakeStripe({
      sessions: { cs_1: "pi_1" },
      captured: { pi_1: 20000 },
      existingRefunds: { pi_1: [18000] },
    });

    const result = await processReturnRefund("SHP-1", undefined, stripe);

    expect(result.status).toBe("refunded");
    expect(result.refunded).toBe(20);
    expect(result.totalRefunded).toBe(200);
    expect(result.fullyRefunded).toBe(true);
    expect(create).toHaveBeenCalledWith(
      { payment_intent: "pi_1", amount: 2000 },
      expect.anything(),
    );
  });

  it("refunds nothing for an even exchange (amount=0) but still marks it processed", async () => {
    mockFindShop.mockResolvedValue(shopOrder());
    const { stripe, create } = fakeStripe({
      sessions: { cs_1: "pi_1" },
      captured: { pi_1: 20000 },
    });

    const result = await processReturnRefund("SHP-1", 0, stripe);

    expect(result.status).toBe("already_at_target");
    expect(result.refunded).toBe(0);
    expect(create).not.toHaveBeenCalled();
    expect(mockRecord).toHaveBeenCalledWith("shop-page", 0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  // Stripe is the source of truth, so a refund the atelier issued by hand in the
  // Dashboard counts against the target just like one we issued.
  it("counts a refund issued by hand in the Dashboard", async () => {
    mockFindShop.mockResolvedValue(shopOrder({ refundedAmount: 0 }));
    const { stripe, create } = fakeStripe({
      sessions: { cs_1: "pi_1" },
      captured: { pi_1: 20000 },
      existingRefunds: { pi_1: [5000, 3000] },
    });

    const result = await processReturnRefund("SHP-1", 8000, stripe);

    expect(result.status).toBe("already_at_target");
    expect(result.totalRefunded).toBe(80);
    expect(create).not.toHaveBeenCalled();
  });

  it("clamps a target above the captured amount and says so", async () => {
    mockFindShop.mockResolvedValue(shopOrder());
    const { stripe, create } = fakeStripe({
      sessions: { cs_1: "pi_1" },
      captured: { pi_1: 20000 },
    });

    const result = await processReturnRefund("SHP-1", 50000, stripe);

    expect(result.status).toBe("refunded");
    expect(result.refunded).toBe(200);
    expect(create).toHaveBeenCalledWith(
      { payment_intent: "pi_1", amount: 20000 },
      expect.anything(),
    );
    expect(result.notes.join(" ")).toMatch(/exceeds/i);
  });

  it("reports no_payment when the order has no Stripe session recorded", async () => {
    mockFindShop.mockResolvedValue(shopOrder({ sessionId: "" }));
    const { stripe, create } = fakeStripe();

    const result = await processReturnRefund("SHP-1", undefined, stripe);

    expect(result.status).toBe("no_payment");
    expect(create).not.toHaveBeenCalled();
    expect(result.notes.join(" ")).toMatch(/refund manually/i);
  });

  it("reports no_payment for a $0 / fully-promo session", async () => {
    mockFindShop.mockResolvedValue(shopOrder());
    const { stripe, create } = fakeStripe({ sessions: { cs_1: null } });

    const result = await processReturnRefund("SHP-1", undefined, stripe);

    expect(result.status).toBe("no_payment");
    expect(create).not.toHaveBeenCalled();
  });

  it("captures a Stripe failure as an error result rather than throwing", async () => {
    vi.spyOn(logger, "error").mockImplementation(() => logger);
    mockFindShop.mockResolvedValue(shopOrder({ refundedAmount: 25 }));
    const { stripe } = fakeStripe({ sessions: { cs_1: "throw" } });

    const result = await processReturnRefund("SHP-1", undefined, stripe);

    expect(result.status).toBe("error");
    expect(result.refunded).toBe(0);
    // Falls back to the last recorded total so the summary isn't misleading.
    expect(result.totalRefunded).toBe(25);
    expect(mockRecord).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  // The money has already moved by the time the marker is written, so a failed
  // Notion write must not present as a failed refund.
  it("keeps the refund when the Notion marker write fails", async () => {
    mockFindShop.mockResolvedValue(shopOrder());
    mockRecord.mockResolvedValue(false);
    const { stripe } = fakeStripe({
      sessions: { cs_1: "pi_1" },
      captured: { pi_1: 20000 },
    });

    const result = await processReturnRefund("SHP-1", undefined, stripe);

    expect(result.status).toBe("refunded");
    expect(result.refunded).toBe(200);
    expect(result.markerFailed).toBe(true);
    expect(result.notes.join(" ")).toMatch(/could not be written/i);
  });

  it("emails the customer when money moved", async () => {
    process.env.RESEND_FROM_EMAIL = "orders@a3iceanddance.com";
    mockFindShop.mockResolvedValue(shopOrder());
    const { stripe } = fakeStripe({
      sessions: { cs_1: "pi_1" },
      captured: { pi_1: 20000 },
    });

    await processReturnRefund("SHP-1", 18000, stripe);

    expect(mockSend).toHaveBeenCalledOnce();
    const message = mockSend.mock.calls[0][0];
    expect(message.to).toBe("ada@example.com");
    expect(message.subject).toContain("SHP-1");
    expect(message.text).toContain("$180.00");
    delete process.env.RESEND_FROM_EMAIL;
  });

  it("skips the email for a legacy order with no stored address", async () => {
    mockFindShop.mockResolvedValue(shopOrder({ email: "" }));
    const { stripe } = fakeStripe({
      sessions: { cs_1: "pi_1" },
      captured: { pi_1: 20000 },
    });

    const result = await processReturnRefund("SHP-1", undefined, stripe);

    expect(result.status).toBe("refunded");
    expect(mockSend).not.toHaveBeenCalled();
  });
});
