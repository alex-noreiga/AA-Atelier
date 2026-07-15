import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/notion/orders.repository.js", () => ({
  findOrderByNumber: vi.fn(),
}));
vi.mock("../../src/lib/notion/invoice.repository.js", () => ({
  findInvoice: vi.fn(),
  listInvoiceLineItems: vi.fn(),
  markBalancePaid: vi.fn(),
}));

import type Stripe from "stripe";
import {
  buildInvoiceView,
  createInvoiceCheckout,
  recordInvoicePayment,
} from "../../src/services/invoice.service.js";
import { BadRequestError, NotFoundError } from "../../src/lib/errors.js";
import { findOrderByNumber } from "../../src/lib/notion/orders.repository.js";
import {
  findInvoice,
  listInvoiceLineItems,
  markBalancePaid,
} from "../../src/lib/notion/invoice.repository.js";
import type { OrderRecord } from "../../src/lib/notion/orders.schema.js";
import type {
  InvoiceRecord,
  InvoiceLineItemRecord,
} from "../../src/lib/notion/invoice.schema.js";

const mockFindOrder = vi.mocked(findOrderByNumber);
const mockFindInvoice = vi.mocked(findInvoice);
const mockListLines = vi.mocked(listInvoiceLineItems);
const mockMark = vi.mocked(markBalancePaid);

function order(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    orderNumber: "ORD-1",
    orderName: "Ada – Custom Dress",
    currentStage: "Sewing",
    stages: ["Sewing"],
    pageId: "order-1",
    invoicePageId: "inv-1",
    depositAmount: 100,
    depositPaid: true,
    deposit2Amount: 50,
    deposit2Paid: false,
    ...overrides,
  };
}

function invoice(overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    pageId: "inv-1",
    invoiceId: "Toothless",
    ready: true,
    balancePaid: false,
    ...overrides,
  };
}

const LINES: InvoiceLineItemRecord[] = [
  { name: "Main fabric", type: "Material", amount: 40 },
  { name: "Rhinestones", type: "Material", amount: 55.5 },
  { name: "Construction", type: "Labor", amount: 120 },
  { name: "Deposit 1", type: "Deposit", amount: 100 },
];

function fakeStripe(url = "https://checkout.stripe.test/invoice") {
  const create = vi.fn().mockResolvedValue({ url });
  return {
    stripe: { checkout: { sessions: { create } } } as unknown as Stripe,
    create,
  };
}

beforeEach(() => {
  process.env.PUBLIC_BASE_URL = "https://shop.test";
});

describe("buildInvoiceView", () => {
  it("subtotals non-deposit lines and credits only paid deposits", () => {
    const view = buildInvoiceView(order(), invoice(), LINES);

    // 40 + 55.5 + 120 = 215.5; the Deposit line is excluded from the subtotal.
    expect(view.subtotal).toBe(215.5);
    // Only Deposit 1 (100) is paid; Deposit 2 (50) is unpaid so it doesn't credit.
    expect(view.depositsCreditedTotal).toBe(100);
    expect(view.balanceDue).toBe(115.5);
    expect(view.lineItems).toHaveLength(3);
    expect(view.deposits).toEqual([
      { label: "Deposit 1", amount: 100, paid: true },
      { label: "Deposit 2", amount: 50, paid: false },
    ]);
    expect(view.paid).toBe(false);
    expect(view.invoiceId).toBe("Toothless");
  });

  it("floors the balance at 0 when deposits exceed the subtotal", () => {
    const view = buildInvoiceView(
      order({
        depositAmount: 500,
        depositPaid: true,
        deposit2Amount: undefined,
      }),
      invoice(),
      LINES,
    );
    expect(view.balanceDue).toBe(0);
  });
});

describe("createInvoiceCheckout", () => {
  it("prices the balance from the line items and tags the session for the webhook", async () => {
    mockFindOrder.mockResolvedValue(order());
    mockFindInvoice.mockResolvedValue(invoice());
    mockListLines.mockResolvedValue(LINES);
    const { stripe, create } = fakeStripe("https://checkout.stripe.test/xyz");

    const result = await createInvoiceCheckout("ORD-1", stripe);

    expect(result).toEqual({ url: "https://checkout.stripe.test/xyz" });
    const params = create.mock.calls[0][0];
    expect(params.mode).toBe("payment");
    // 115.5 dollars → 11550 cents.
    expect(params.line_items[0].price_data.unit_amount).toBe(11550);
    expect(params.line_items[0].price_data.tax_behavior).toBe("exclusive");
    expect(params.line_items[0].price_data.product_data).toEqual({
      name: "Balance — Ada – Custom Dress",
    });
    expect(params.automatic_tax).toEqual({ enabled: true });
    expect(params.billing_address_collection).toBe("required");
    expect(params.metadata).toEqual({
      kind: "invoice",
      orderNumber: "ORD-1",
      orderPageId: "order-1",
      invoicePageId: "inv-1",
    });
  });

  it("404s when the order doesn't exist", async () => {
    mockFindOrder.mockResolvedValue(null);
    const { stripe, create } = fakeStripe();
    await expect(
      createInvoiceCheckout("ORD-NOPE", stripe),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(create).not.toHaveBeenCalled();
  });

  it("400s when the order has no invoice", async () => {
    mockFindOrder.mockResolvedValue(order({ invoicePageId: undefined }));
    const { stripe, create } = fakeStripe();
    await expect(createInvoiceCheckout("ORD-1", stripe)).rejects.toBeInstanceOf(
      BadRequestError,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("400s when the invoice isn't ready", async () => {
    mockFindOrder.mockResolvedValue(order());
    mockFindInvoice.mockResolvedValue(invoice({ ready: false }));
    const { stripe, create } = fakeStripe();
    await expect(createInvoiceCheckout("ORD-1", stripe)).rejects.toBeInstanceOf(
      BadRequestError,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("400s when the balance is already paid", async () => {
    mockFindOrder.mockResolvedValue(order());
    mockFindInvoice.mockResolvedValue(invoice({ balancePaid: true }));
    const { stripe, create } = fakeStripe();
    await expect(createInvoiceCheckout("ORD-1", stripe)).rejects.toBeInstanceOf(
      BadRequestError,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("400s when there's no outstanding balance", async () => {
    mockFindOrder.mockResolvedValue(
      order({ depositAmount: 1000, depositPaid: true }),
    );
    mockFindInvoice.mockResolvedValue(invoice());
    mockListLines.mockResolvedValue(LINES);
    const { stripe, create } = fakeStripe();
    await expect(createInvoiceCheckout("ORD-1", stripe)).rejects.toBeInstanceOf(
      BadRequestError,
    );
    expect(create).not.toHaveBeenCalled();
  });
});

describe("recordInvoicePayment", () => {
  it("marks the order + invoice balance paid for a paid session", async () => {
    await recordInvoicePayment({
      id: "cs_9",
      payment_status: "paid",
      metadata: {
        kind: "invoice",
        orderPageId: "order-1",
        invoicePageId: "inv-1",
      },
    } as unknown as Stripe.Checkout.Session);

    expect(mockMark).toHaveBeenCalledWith("order-1", "inv-1", "cs_9");
  });

  it("does nothing for an unpaid session", async () => {
    await recordInvoicePayment({
      id: "cs_10",
      payment_status: "unpaid",
      metadata: { orderPageId: "order-1", invoicePageId: "inv-1" },
    } as unknown as Stripe.Checkout.Session);
    expect(mockMark).not.toHaveBeenCalled();
  });

  it("throws when the session is missing page metadata", async () => {
    await expect(
      recordInvoicePayment({
        id: "cs_11",
        payment_status: "paid",
        metadata: {},
      } as unknown as Stripe.Checkout.Session),
    ).rejects.toThrow(/order\/invoice page metadata/);
  });
});
