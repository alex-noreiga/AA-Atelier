import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/notion/orders.repository.js", () => ({
  findOrderByNumber: vi.fn(),
  findOrderForStageNotification: vi.fn(),
}));
vi.mock("../../src/lib/notion/invoice.repository.js", () => ({
  findInvoice: vi.fn(),
  listInvoiceLineItems: vi.fn(),
  markInvoicePaid: vi.fn(),
}));
// Rewards are a best-effort side effect on the payment recorder; mock so the
// tests assert the wiring and failure branch without touching Notion/Stripe.
vi.mock("../../src/services/rewards.service.js", () => ({
  runPaidOrderRewards: vi.fn(),
}));

import type Stripe from "stripe";
import {
  buildInvoiceView,
  getInvoicePaymentInfo,
  createPaymentCheckout,
  recordPayment,
} from "../../src/services/invoice.service.js";
import { BadRequestError, NotFoundError } from "../../src/lib/errors.js";
import {
  findOrderByNumber,
  findOrderForStageNotification,
} from "../../src/lib/notion/orders.repository.js";
import {
  findInvoice,
  listInvoiceLineItems,
  markInvoicePaid,
} from "../../src/lib/notion/invoice.repository.js";
import { runPaidOrderRewards } from "../../src/services/rewards.service.js";
import type { OrderRecord } from "../../src/lib/notion/orders.schema.js";
import type {
  InvoiceRecord,
  InvoiceLineItemRecord,
  InvoiceDepositView,
} from "../../src/lib/notion/invoice.schema.js";

const mockFindOrder = vi.mocked(findOrderByNumber);
const mockFindForNotify = vi.mocked(findOrderForStageNotification);
const mockFindInvoice = vi.mocked(findInvoice);
const mockListLines = vi.mocked(listInvoiceLineItems);
const mockMark = vi.mocked(markInvoicePaid);
const mockRewards = vi.mocked(runPaidOrderRewards);

function order(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    orderNumber: "ORD-1",
    orderName: "Ada – Custom Dress",
    currentStage: "Sewing",
    stages: ["Sewing"],
    pageId: "order-1",
    invoicePageId: "inv-1",
    ...overrides,
  };
}

const DEPOSITS: InvoiceDepositView[] = [
  { stage: "first_deposit", label: "First deposit", amount: 100, paid: true },
  { stage: "second_deposit", label: "Second deposit", amount: 50, paid: false },
];

function invoice(overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    pageId: "inv-1",
    invoiceId: "Toothless",
    ready: true,
    balancePaid: false,
    deposits: DEPOSITS,
    ...overrides,
  };
}

// The "Deposit" line is deliberately not a live `Line Type` option any more —
// it's here to pin the guard in `buildInvoiceView`, so that re-adding that
// option in Notion can never bill a customer for their own deposit.
const LINES: InvoiceLineItemRecord[] = [
  { name: "Main fabric", type: "Material", amount: 40 },
  { name: "Rhinestones", type: "Material", amount: 55.5 },
  { name: "Construction", type: "Labor", amount: 120 },
  { name: "Deposit 1", type: "Deposit", amount: 100 },
];

function fakeStripe(url = "https://checkout.stripe.test/pay") {
  const create = vi.fn().mockResolvedValue({ url });
  return {
    stripe: { checkout: { sessions: { create } } } as unknown as Stripe,
    create,
  };
}

beforeEach(() => {
  process.env.PUBLIC_BASE_URL = "https://shop.test";
  delete process.env.STRIPE_BNPL_METHODS;
});

describe("buildInvoiceView", () => {
  it("subtotals non-deposit lines and credits only paid deposits", () => {
    const view = buildInvoiceView(invoice(), LINES);

    // 40 + 55.5 + 120 = 215.5; the Deposit line is excluded from the subtotal.
    expect(view.subtotal).toBe(215.5);
    // Only the first deposit (100) is paid; the second (50) is unpaid.
    expect(view.depositsCreditedTotal).toBe(100);
    expect(view.balanceDue).toBe(115.5);
    expect(view.lineItems).toHaveLength(3);
    expect(view.paid).toBe(false);
    expect(view.invoiceId).toBe("Toothless");
  });

  it("floors the balance at 0 when deposits exceed the subtotal", () => {
    const view = buildInvoiceView(
      invoice({
        deposits: [
          {
            stage: "first_deposit",
            label: "First deposit",
            amount: 500,
            paid: true,
          },
        ],
      }),
      LINES,
    );
    expect(view.balanceDue).toBe(0);
  });
});

describe("getInvoicePaymentInfo", () => {
  it("returns empty when the order has no invoice", async () => {
    const info = await getInvoicePaymentInfo(
      order({ invoicePageId: undefined }),
    );
    expect(info).toEqual({ deposits: [], invoice: null });
    expect(mockFindInvoice).not.toHaveBeenCalled();
  });

  it("surfaces deposits but no itemized invoice until it's ready", async () => {
    mockFindInvoice.mockResolvedValue(invoice({ ready: false }));
    const info = await getInvoicePaymentInfo(order());
    expect(info.deposits).toEqual(DEPOSITS);
    expect(info.invoice).toBeNull();
    expect(mockListLines).not.toHaveBeenCalled();
  });

  it("builds the itemized invoice once ready", async () => {
    mockFindInvoice.mockResolvedValue(invoice());
    mockListLines.mockResolvedValue(LINES);
    const info = await getInvoicePaymentInfo(order());
    expect(info.deposits).toEqual(DEPOSITS);
    expect(info.invoice?.balanceDue).toBe(115.5);
  });

  // A repair is quoted and paid once, so "First deposit" would tell the
  // customer a second instalment is coming. The stages themselves are
  // untouched — only what they're called. See `services/payment-labels.ts`.
  it("calls a lone deposit on a repair just 'Deposit'", async () => {
    mockFindInvoice.mockResolvedValue(
      invoice({
        ready: false,
        deposits: [
          {
            stage: "first_deposit",
            label: "First deposit",
            amount: 100,
            paid: false,
          },
        ],
      }),
    );
    const info = await getInvoicePaymentInfo(
      order({ service: "Repairs & Restoration" }),
    );
    expect(info.deposits[0]).toMatchObject({
      stage: "first_deposit",
      label: "Deposit",
      amount: 100,
    });
  });

  it("keeps the commission's staged wording", async () => {
    mockFindInvoice.mockResolvedValue(invoice({ ready: false }));
    const info = await getInvoicePaymentInfo(
      order({ service: "Bespoke Commission" }),
    );
    expect(info.deposits.map((d) => d.label)).toEqual([
      "First deposit",
      "Second deposit",
    ]);
  });

  // An order placed before the `Service` property existed resolves to the
  // bespoke commission, i.e. exactly the wording it has always been shown.
  it("leaves a legacy order with no service untouched", async () => {
    mockFindInvoice.mockResolvedValue(invoice({ ready: false }));
    const info = await getInvoicePaymentInfo(order({ service: undefined }));
    expect(info.deposits).toEqual(DEPOSITS);
  });
});

describe("createPaymentCheckout", () => {
  it("prices the first deposit untaxed and tags the session", async () => {
    mockFindOrder.mockResolvedValue(order());
    mockFindInvoice.mockResolvedValue(
      invoice({
        deposits: [
          {
            stage: "first_deposit",
            label: "First deposit",
            amount: 100,
            paid: false,
          },
        ],
      }),
    );
    const { stripe, create } = fakeStripe("https://checkout.stripe.test/dep");

    const result = await createPaymentCheckout(
      "ORD-1",
      "first_deposit",
      stripe,
    );

    expect(result).toEqual({ url: "https://checkout.stripe.test/dep" });
    const params = create.mock.calls[0][0];
    expect(params.line_items[0].price_data.unit_amount).toBe(10000);
    expect(params.line_items[0].price_data.tax_behavior).toBeUndefined();
    expect(params.line_items[0].price_data.product_data).toEqual({
      name: "First deposit — Ada – Custom Dress",
    });
    expect(params.automatic_tax).toBeUndefined();
    // A promo code or gift card can be redeemed against a deposit on Stripe's
    // hosted page (same box as the shop cart).
    expect(params.allow_promotion_codes).toBe(true);
    expect(params.metadata).toEqual({
      kind: "custom_payment",
      stage: "first_deposit",
      orderNumber: "ORD-1",
      orderPageId: "order-1",
      invoicePageId: "inv-1",
    });
    expect(mockListLines).not.toHaveBeenCalled();
  });

  it("prices the balance from the line items, taxed", async () => {
    mockFindOrder.mockResolvedValue(order());
    mockFindInvoice.mockResolvedValue(invoice());
    mockListLines.mockResolvedValue(LINES);
    const { stripe, create } = fakeStripe();

    await createPaymentCheckout("ORD-1", "balance", stripe);

    const params = create.mock.calls[0][0];
    // 115.5 dollars → 11550 cents.
    expect(params.line_items[0].price_data.unit_amount).toBe(11550);
    expect(params.line_items[0].price_data.tax_behavior).toBe("exclusive");
    expect(params.line_items[0].price_data.product_data).toEqual({
      name: "Balance — Ada – Custom Dress",
    });
    expect(params.automatic_tax).toEqual({ enabled: true });
    expect(params.billing_address_collection).toBe("required");
    // Promo codes / gift cards are redeemable on the balance too; Stripe
    // recomputes tax on the discounted amount.
    expect(params.allow_promotion_codes).toBe(true);
    expect(params.metadata.stage).toBe("balance");
    // No BNPL configured -> payment methods stay dynamic.
    expect(params.payment_method_types).toBeUndefined();
  });

  it("offers buy-now-pay-later on the balance when configured", async () => {
    process.env.STRIPE_BNPL_METHODS = "klarna,affirm";
    mockFindOrder.mockResolvedValue(order());
    mockFindInvoice.mockResolvedValue(invoice());
    mockListLines.mockResolvedValue(LINES);
    const { stripe, create } = fakeStripe();

    await createPaymentCheckout("ORD-1", "balance", stripe);

    expect(create.mock.calls[0][0].payment_method_types).toEqual([
      "card",
      "klarna",
      "affirm",
    ]);
  });

  it("never offers BNPL on a deposit, even when configured (deposits stay card-only)", async () => {
    process.env.STRIPE_BNPL_METHODS = "klarna,affirm";
    mockFindOrder.mockResolvedValue(order());
    mockFindInvoice.mockResolvedValue(
      invoice({
        deposits: [
          {
            stage: "first_deposit",
            label: "First deposit",
            amount: 100,
            paid: false,
          },
        ],
      }),
    );
    const { stripe, create } = fakeStripe();

    await createPaymentCheckout("ORD-1", "first_deposit", stripe);

    expect(create.mock.calls[0][0].payment_method_types).toBeUndefined();
  });

  it("404s when the order doesn't exist", async () => {
    mockFindOrder.mockResolvedValue(null);
    const { stripe, create } = fakeStripe();
    await expect(
      createPaymentCheckout("ORD-NOPE", "first_deposit", stripe),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(create).not.toHaveBeenCalled();
  });

  it("400s when the order has no invoice", async () => {
    mockFindOrder.mockResolvedValue(order({ invoicePageId: undefined }));
    const { stripe, create } = fakeStripe();
    await expect(
      createPaymentCheckout("ORD-1", "first_deposit", stripe),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(create).not.toHaveBeenCalled();
  });

  it("400s when the requested deposit has no amount set", async () => {
    mockFindOrder.mockResolvedValue(order());
    mockFindInvoice.mockResolvedValue(invoice({ deposits: [] }));
    const { stripe, create } = fakeStripe();
    await expect(
      createPaymentCheckout("ORD-1", "second_deposit", stripe),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(create).not.toHaveBeenCalled();
  });

  it("400s when the deposit is already paid", async () => {
    mockFindOrder.mockResolvedValue(order());
    mockFindInvoice.mockResolvedValue(invoice());
    const { stripe, create } = fakeStripe();
    // The default first deposit is paid.
    await expect(
      createPaymentCheckout("ORD-1", "first_deposit", stripe),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(create).not.toHaveBeenCalled();
  });

  it("400s for a balance when the invoice isn't ready", async () => {
    mockFindOrder.mockResolvedValue(order());
    mockFindInvoice.mockResolvedValue(invoice({ ready: false }));
    const { stripe, create } = fakeStripe();
    await expect(
      createPaymentCheckout("ORD-1", "balance", stripe),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(create).not.toHaveBeenCalled();
  });

  it("400s for a balance already paid", async () => {
    mockFindOrder.mockResolvedValue(order());
    mockFindInvoice.mockResolvedValue(invoice({ balancePaid: true }));
    const { stripe, create } = fakeStripe();
    await expect(
      createPaymentCheckout("ORD-1", "balance", stripe),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(create).not.toHaveBeenCalled();
  });

  it("400s when there's no outstanding balance", async () => {
    mockFindOrder.mockResolvedValue(order());
    mockFindInvoice.mockResolvedValue(
      invoice({
        deposits: [
          {
            stage: "first_deposit",
            label: "First deposit",
            amount: 1000,
            paid: true,
          },
        ],
      }),
    );
    mockListLines.mockResolvedValue(LINES);
    const { stripe, create } = fakeStripe();
    await expect(
      createPaymentCheckout("ORD-1", "balance", stripe),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("recordPayment", () => {
  it("marks the invoice stage paid for a paid session", async () => {
    await recordPayment({
      id: "cs_9",
      payment_status: "paid",
      metadata: {
        kind: "custom_payment",
        stage: "second_deposit",
        invoicePageId: "inv-1",
      },
    } as unknown as Stripe.Checkout.Session);

    expect(mockMark).toHaveBeenCalledWith("inv-1", "second_deposit", "cs_9");
  });

  it("does nothing for an unpaid session", async () => {
    await recordPayment({
      id: "cs_10",
      payment_status: "unpaid",
      metadata: { stage: "balance", invoicePageId: "inv-1" },
    } as unknown as Stripe.Checkout.Session);
    expect(mockMark).not.toHaveBeenCalled();
  });

  it("throws when the session is missing a valid stage/invoice metadata", async () => {
    await expect(
      recordPayment({
        id: "cs_11",
        payment_status: "paid",
        metadata: { stage: "bogus", invoicePageId: "inv-1" },
      } as unknown as Stripe.Checkout.Session),
    ).rejects.toThrow(/stage\/invoice metadata/);
  });

  it("runs the reward passes with the order's email + number after marking paid", async () => {
    mockFindForNotify.mockResolvedValue({
      email: "ada@example.com",
    } as never);

    await recordPayment({
      id: "cs_rw",
      payment_status: "paid",
      metadata: {
        kind: "custom_payment",
        stage: "first_deposit",
        invoicePageId: "inv-1",
        orderNumber: "ORD-77",
      },
    } as unknown as Stripe.Checkout.Session);

    expect(mockMark).toHaveBeenCalledWith("inv-1", "first_deposit", "cs_rw");
    expect(mockFindForNotify).toHaveBeenCalledWith("ORD-77");
    expect(mockRewards).toHaveBeenCalledWith("ada@example.com", "ORD-77");
  });

  it("does not run rewards when the order has no email on file", async () => {
    mockFindForNotify.mockResolvedValue({ email: "" } as never);

    await recordPayment({
      id: "cs_rw2",
      payment_status: "paid",
      metadata: {
        kind: "custom_payment",
        stage: "first_deposit",
        invoicePageId: "inv-1",
        orderNumber: "ORD-78",
      },
    } as unknown as Stripe.Checkout.Session);

    expect(mockRewards).not.toHaveBeenCalled();
  });

  it("still records the payment when the reward pass throws (best-effort)", async () => {
    mockFindForNotify.mockResolvedValue({
      email: "ada@example.com",
    } as never);
    mockRewards.mockRejectedValueOnce(new Error("reward boom"));

    await expect(
      recordPayment({
        id: "cs_rw3",
        payment_status: "paid",
        metadata: {
          kind: "custom_payment",
          stage: "balance",
          invoicePageId: "inv-1",
          orderNumber: "ORD-79",
        },
      } as unknown as Stripe.Checkout.Session),
    ).resolves.toBeUndefined();
    expect(mockMark).toHaveBeenCalledWith("inv-1", "balance", "cs_rw3");
  });
});
