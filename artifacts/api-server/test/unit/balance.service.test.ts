import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/notion/orders.repository.js", () => ({
  findDepositTarget: vi.fn(),
}));
vi.mock("../../src/lib/notion/invoices.repository.js", async (importActual) => {
  const actual =
    await importActual<
      typeof import("../../src/lib/notion/invoices.repository.js")
    >();
  return {
    ...actual, // keep the real computeBalanceDue
    findInvoiceById: vi.fn(),
    markBalancePaid: vi.fn(),
  };
});

import type Stripe from "stripe";
import {
  createBalanceCheckout,
  recordBalancePayment,
} from "../../src/services/balance.service.js";
import { BadRequestError, NotFoundError } from "../../src/lib/errors.js";
import { findDepositTarget } from "../../src/lib/notion/orders.repository.js";
import {
  findInvoiceById,
  markBalancePaid,
} from "../../src/lib/notion/invoices.repository.js";

const mockFindOrder = vi.mocked(findDepositTarget);
const mockFindInvoice = vi.mocked(findInvoiceById);
const mockMark = vi.mocked(markBalancePaid);

function fakeStripe(url = "https://checkout.stripe.test/balance") {
  const create = vi.fn().mockResolvedValue({ url });
  const stripe = {
    checkout: { sessions: { create } },
  } as unknown as Stripe;
  return { stripe, create };
}

const order = (overrides = {}) => ({
  pageId: "page-42",
  orderName: "Ada – Custom Dress",
  invoicePageId: "inv-1",
  depositAmount: 200,
  depositPaid: true,
  ...overrides,
});

const invoice = (overrides = {}) => ({
  finalBalance: 800,
  balancePaid: false,
  invoiceReady: true,
  ...overrides,
});

beforeEach(() => {
  process.env.PUBLIC_BASE_URL = "https://shop.test";
});

describe("createBalanceCheckout", () => {
  it("charges final balance minus the paid deposit, taxed, tagged for the webhook", async () => {
    mockFindOrder.mockResolvedValue(order());
    mockFindInvoice.mockResolvedValue(invoice());
    const { stripe, create } = fakeStripe("https://checkout.stripe.test/xyz");

    const result = await createBalanceCheckout("ORD-1", stripe);

    expect(result).toEqual({ url: "https://checkout.stripe.test/xyz" });
    const params = create.mock.calls[0][0];
    // 800 final − 200 deposit = 600 → 60000 cents.
    expect(params.line_items[0].price_data.unit_amount).toBe(60000);
    expect(params.line_items[0].price_data.product_data).toEqual({
      name: "Balance — Ada – Custom Dress",
    });
    // Unlike the deposit, the balance is taxed.
    expect(params.automatic_tax).toEqual({ enabled: true });
    expect(params.metadata).toEqual({
      kind: "balance",
      orderNumber: "ORD-1",
      invoicePageId: "inv-1",
    });
  });

  it("charges the full final balance when no deposit was set", async () => {
    mockFindOrder.mockResolvedValue(
      order({ depositAmount: undefined, depositPaid: false }),
    );
    mockFindInvoice.mockResolvedValue(invoice({ finalBalance: 500 }));
    const { stripe, create } = fakeStripe();

    await createBalanceCheckout("ORD-1", stripe);

    expect(create.mock.calls[0][0].line_items[0].price_data.unit_amount).toBe(
      50000,
    );
  });

  it("404s when the order doesn't exist", async () => {
    mockFindOrder.mockResolvedValue(null);
    const { stripe, create } = fakeStripe();
    await expect(createBalanceCheckout("ORD-NOPE", stripe)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("400s when there's no invoice for the order", async () => {
    mockFindOrder.mockResolvedValue(order({ invoicePageId: undefined }));
    mockFindInvoice.mockResolvedValue(null);
    const { stripe, create } = fakeStripe();
    await expect(createBalanceCheckout("ORD-1", stripe)).rejects.toBeInstanceOf(
      BadRequestError,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("400s when the invoice isn't marked ready", async () => {
    mockFindOrder.mockResolvedValue(order());
    mockFindInvoice.mockResolvedValue(invoice({ invoiceReady: false }));
    const { stripe, create } = fakeStripe();
    await expect(createBalanceCheckout("ORD-1", stripe)).rejects.toThrow(
      /isn't ready/,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("400s when the balance is already paid", async () => {
    mockFindOrder.mockResolvedValue(order());
    mockFindInvoice.mockResolvedValue(invoice({ balancePaid: true }));
    const { stripe, create } = fakeStripe();
    await expect(createBalanceCheckout("ORD-1", stripe)).rejects.toThrow(
      /already been paid/,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("400s when a set deposit is still outstanding", async () => {
    mockFindOrder.mockResolvedValue(order({ depositPaid: false }));
    mockFindInvoice.mockResolvedValue(invoice());
    const { stripe, create } = fakeStripe();
    await expect(createBalanceCheckout("ORD-1", stripe)).rejects.toThrow(
      /deposit first/,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("400s when the computed balance is zero or negative", async () => {
    mockFindOrder.mockResolvedValue(order({ depositAmount: 800, depositPaid: true }));
    mockFindInvoice.mockResolvedValue(invoice({ finalBalance: 800 }));
    const { stripe, create } = fakeStripe();
    await expect(createBalanceCheckout("ORD-1", stripe)).rejects.toThrow(
      /no balance due/,
    );
    expect(create).not.toHaveBeenCalled();
  });
});

describe("recordBalancePayment", () => {
  it("marks the invoice balance paid for a paid session", async () => {
    await recordBalancePayment({
      id: "cs_test_1",
      payment_status: "paid",
      metadata: { invoicePageId: "inv-1" },
    } as unknown as Stripe.Checkout.Session);

    expect(mockMark).toHaveBeenCalledWith("inv-1", "cs_test_1");
  });

  it("ignores an unpaid session", async () => {
    await recordBalancePayment({
      id: "cs_test_1",
      payment_status: "unpaid",
      metadata: { invoicePageId: "inv-1" },
    } as unknown as Stripe.Checkout.Session);

    expect(mockMark).not.toHaveBeenCalled();
  });

  it("throws when the invoicePageId metadata is missing", async () => {
    await expect(
      recordBalancePayment({
        id: "cs_test_1",
        payment_status: "paid",
        metadata: {},
      } as unknown as Stripe.Checkout.Session),
    ).rejects.toThrow(/missing invoicePageId/);
  });
});
