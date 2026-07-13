import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/notion/orders.repository.js", () => ({
  findDepositTarget: vi.fn(),
  markDepositPaid: vi.fn(),
}));

import type Stripe from "stripe";
import {
  createDepositCheckout,
  recordDepositPayment,
} from "../../src/services/deposit.service.js";
import { BadRequestError, NotFoundError } from "../../src/lib/errors.js";
import {
  findDepositTarget,
  markDepositPaid,
} from "../../src/lib/notion/orders.repository.js";

const mockFind = vi.mocked(findDepositTarget);
const mockMark = vi.mocked(markDepositPaid);

function fakeStripe(url = "https://checkout.stripe.test/deposit") {
  const create = vi.fn().mockResolvedValue({ url });
  const stripe = {
    checkout: { sessions: { create } },
  } as unknown as Stripe;
  return { stripe, create };
}

beforeEach(() => {
  process.env.PUBLIC_BASE_URL = "https://shop.test";
});

describe("createDepositCheckout", () => {
  it("prices the deposit from Notion and tags the session for the webhook", async () => {
    mockFind.mockResolvedValue({
      pageId: "page-42",
      orderName: "Ada – Custom Dress",
      depositAmount: 150,
      depositPaid: false,
    });
    const { stripe, create } = fakeStripe("https://checkout.stripe.test/abc");

    const result = await createDepositCheckout("ORD-1", stripe);

    expect(result).toEqual({ url: "https://checkout.stripe.test/abc" });
    const params = create.mock.calls[0][0];
    expect(params.mode).toBe("payment");
    expect(params.line_items[0].price_data.unit_amount).toBe(15000);
    expect(params.line_items[0].price_data.product_data).toEqual({
      name: "Deposit — Ada – Custom Dress",
    });
    expect(params.metadata).toEqual({
      kind: "deposit",
      orderNumber: "ORD-1",
      orderPageId: "page-42",
    });
  });

  it("404s when the order doesn't exist", async () => {
    mockFind.mockResolvedValue(null);
    const { stripe, create } = fakeStripe();

    await expect(
      createDepositCheckout("ORD-NOPE", stripe),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(create).not.toHaveBeenCalled();
  });

  it("400s when no deposit has been set", async () => {
    mockFind.mockResolvedValue({
      pageId: "p",
      orderName: "Ada",
      depositPaid: false,
    });
    const { stripe, create } = fakeStripe();

    await expect(createDepositCheckout("ORD-1", stripe)).rejects.toBeInstanceOf(
      BadRequestError,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("400s when the deposit is already paid", async () => {
    mockFind.mockResolvedValue({
      pageId: "p",
      orderName: "Ada",
      depositAmount: 150,
      depositPaid: true,
    });
    const { stripe, create } = fakeStripe();

    await expect(createDepositCheckout("ORD-1", stripe)).rejects.toBeInstanceOf(
      BadRequestError,
    );
    expect(create).not.toHaveBeenCalled();
  });
});

describe("recordDepositPayment", () => {
  it("marks the order's deposit paid for a paid session", async () => {
    await recordDepositPayment({
      id: "cs_1",
      payment_status: "paid",
      metadata: { kind: "deposit", orderPageId: "page-42" },
    } as unknown as Stripe.Checkout.Session);

    expect(mockMark).toHaveBeenCalledWith("page-42", "cs_1");
  });

  it("does nothing for an unpaid session", async () => {
    await recordDepositPayment({
      id: "cs_2",
      payment_status: "unpaid",
      metadata: { orderPageId: "page-42" },
    } as unknown as Stripe.Checkout.Session);

    expect(mockMark).not.toHaveBeenCalled();
  });

  it("throws when the session is missing the order page id", async () => {
    await expect(
      recordDepositPayment({
        id: "cs_3",
        payment_status: "paid",
        metadata: {},
      } as unknown as Stripe.Checkout.Session),
    ).rejects.toThrow(/orderPageId/);
  });
});
