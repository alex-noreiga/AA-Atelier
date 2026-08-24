import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The service resolves the cart against live inventory and records paid orders
// via these adapters; both are mocked so the tests stay pure (no Notion/Stripe).
vi.mock("../../src/lib/notion/products.repository.js", () => ({
  listVariants: vi.fn(),
}));
vi.mock("../../src/lib/notion/shop-orders.repository.js", () => ({
  findOrderBySessionId: vi.fn(),
  createShopOrder: vi.fn(),
}));
// Order lines are the shop's inventory decrement, written best-effort right
// after the order page. Mocking the REPOSITORY (not the service) keeps the real
// Stripe-line -> line mapping under test while touching no Notion. Cleared
// mocks make `orderLinesConfigured` falsy by default, i.e. "not configured",
// which is the pre-lines behavior every other test in this file expects.
vi.mock("../../src/lib/notion/order-lines.repository.js", () => ({
  createOrderLine: vi.fn(),
  orderLinesConfigured: vi.fn(),
}));
// The CRM upsert is a best-effort side effect on the webhook path; mock it so
// the tests drive the link/skip/failure branches without touching Notion.
vi.mock("../../src/lib/notion/clients.repository.js", () => ({
  upsertClientByEmail: vi.fn(),
}));
// The confirmation email is a best-effort side effect; mock the transport so no
// mail is attempted and the dispatch can be asserted.
vi.mock("../../src/lib/resend/send.js", () => ({
  sendEmailBestEffort: vi.fn(),
}));
// Rewards are a best-effort side effect on the webhook tail; mock so the tests
// assert the wiring and drive the failure branch without touching Notion/Stripe.
vi.mock("../../src/services/rewards.service.js", () => ({
  runPaidOrderRewards: vi.fn(),
}));

import type Stripe from "stripe";
import {
  createCheckoutSession,
  getCheckoutSession,
  recordPaidOrder,
} from "../../src/services/checkout.service.js";
import { BadRequestError, NotFoundError } from "../../src/lib/errors.js";
import { logger } from "../../src/lib/logger.js";
import { listVariants } from "../../src/lib/notion/products.repository.js";
import {
  createShopOrder,
  findOrderBySessionId,
} from "../../src/lib/notion/shop-orders.repository.js";
import { upsertClientByEmail } from "../../src/lib/notion/clients.repository.js";
import {
  createOrderLine,
  orderLinesConfigured,
} from "../../src/lib/notion/order-lines.repository.js";
import { sendEmailBestEffort } from "../../src/lib/resend/send.js";
import { runPaidOrderRewards } from "../../src/services/rewards.service.js";
import type { VariantRecord } from "../../src/lib/notion/products.schema.js";
import { __setDbForTests, __resetDb } from "../../src/lib/db/client.js";
import { makeFakeDb } from "../support/fake-db.js";

const mockListVariants = vi.mocked(listVariants);
const mockFind = vi.mocked(findOrderBySessionId);
const mockCreate = vi.mocked(createShopOrder);
const mockUpsertClient = vi.mocked(upsertClientByEmail);
const mockCreateOrderLine = vi.mocked(createOrderLine);
const mockOrderLinesConfigured = vi.mocked(orderLinesConfigured);
const mockSend = vi.mocked(sendEmailBestEffort);
const mockRewards = vi.mocked(runPaidOrderRewards);

function variant(overrides: Partial<VariantRecord> = {}): VariantRecord {
  return {
    id: "v1",
    name: "Bow Fleece Soaker",
    available: true,
    price: 22,
    photos: [],
    sizes: [],
    addOnIds: [],
    category: "Soaker",
    group: null,
    ...overrides,
  };
}

/** A Stripe double that captures the params passed to sessions.create. */
function fakeStripe(url = "https://checkout.stripe.test/pay") {
  const create = vi.fn().mockResolvedValue({ url });
  const retrieve = vi.fn();
  // By default every configured shipping rate resolves as a valid, active USD
  // rate; individual tests override this to exercise the skip-and-warn paths.
  const retrieveShippingRate = vi
    .fn()
    .mockImplementation((id: string) =>
      Promise.resolve({ id, active: true, fixed_amount: { currency: "usd" } }),
    );
  const stripe = {
    checkout: { sessions: { create, retrieve } },
    shippingRates: { retrieve: retrieveShippingRate },
  } as unknown as Stripe;
  return { stripe, create, retrieve, retrieveShippingRate };
}

beforeEach(() => {
  process.env.PUBLIC_BASE_URL = "https://shop.test";
  process.env.RESEND_FROM_EMAIL = "orders@shop.test";
  delete process.env.STRIPE_SHIPPING_RATE_IDS;
  delete process.env.STRIPE_BNPL_METHODS;
  // The atelier notification is opt-in; individual tests set the inbox when they
  // want to exercise it, so clear it by default.
  delete process.env.ATELIER_INBOX_EMAIL;
  // Silence (and let tests assert) the actionable shipping-config error logs.
  vi.spyOn(logger, "error").mockImplementation(() => logger);
});

describe("createCheckoutSession", () => {
  it("prices line items from live inventory (dollars -> cents) and returns the URL", async () => {
    mockListVariants.mockResolvedValue([variant({ id: "v1", price: 22 })]);
    const { stripe, create } = fakeStripe("https://checkout.stripe.test/abc");

    const result = await createCheckoutSession(
      [{ variantId: "v1", quantity: 2 }],
      stripe,
    );

    expect(result).toEqual({ url: "https://checkout.stripe.test/abc" });
    const params = create.mock.calls[0][0];
    expect(params.mode).toBe("payment");
    expect(params.line_items).toEqual([
      {
        quantity: 2,
        price_data: {
          currency: "usd",
          unit_amount: 2200,
          tax_behavior: "exclusive",
          // The inventory page id is stamped on the product metadata so the
          // webhook can relate the shop order back to inventory (card #9).
          product_data: {
            name: "Bow Fleece Soaker",
            metadata: { variantId: "v1" },
          },
        },
      },
    ]);
    // Stripe Tax is computed on the shop cart (deposits stay untaxed).
    expect(params.automatic_tax).toEqual({ enabled: true });
    // Promo/discount codes can be redeemed on Stripe's hosted page.
    expect(params.allow_promotion_codes).toBe(true);
    expect(params.success_url).toContain(
      "https://shop.test/shop/success?session_id={CHECKOUT_SESSION_ID}",
    );
  });

  it("rounds fractional-dollar prices to whole cents", async () => {
    mockListVariants.mockResolvedValue([variant({ price: 22.5 })]);
    const { stripe, create } = fakeStripe();

    await createCheckoutSession([{ variantId: "v1", quantity: 1 }], stripe);

    expect(create.mock.calls[0][0].line_items[0].price_data.unit_amount).toBe(
      2250,
    );
  });

  it("rejects an item that is no longer in inventory", async () => {
    mockListVariants.mockResolvedValue([]);
    const { stripe, create } = fakeStripe();

    await expect(
      createCheckoutSession([{ variantId: "gone", quantity: 1 }], stripe),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects a sold-out item", async () => {
    mockListVariants.mockResolvedValue([variant({ available: false })]);
    const { stripe, create } = fakeStripe();

    await expect(
      createCheckoutSession([{ variantId: "v1", quantity: 1 }], stripe),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(create).not.toHaveBeenCalled();
  });

  it("refuses an unpriced item (inquire-for-price is not purchasable)", async () => {
    const { price: _price, ...noPrice } = variant();
    mockListVariants.mockResolvedValue([noPrice as VariantRecord]);
    const { stripe, create } = fakeStripe();

    await expect(
      createCheckoutSession([{ variantId: "v1", quantity: 1 }], stripe),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects a quantity that exceeds the live stock count (overselling guard)", async () => {
    mockListVariants.mockResolvedValue([variant({ quantityAvailable: 2 })]);
    const { stripe, create } = fakeStripe();

    await expect(
      createCheckoutSession([{ variantId: "v1", quantity: 3 }], stripe),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(create).not.toHaveBeenCalled();
  });

  it("allows a quantity up to the live stock count", async () => {
    mockListVariants.mockResolvedValue([variant({ quantityAvailable: 2 })]);
    const { stripe, create } = fakeStripe();

    await createCheckoutSession([{ variantId: "v1", quantity: 2 }], stripe);

    expect(create.mock.calls[0][0].line_items[0].quantity).toBe(2);
  });

  it("treats a null/absent stock count as uncapped (one-off items)", async () => {
    // quantityAvailable omitted -> undefined -> no ceiling, mirroring how
    // availability treats a null count as available.
    mockListVariants.mockResolvedValue([variant()]);
    const { stripe, create } = fakeStripe();

    await createCheckoutSession([{ variantId: "v1", quantity: 99 }], stripe);

    expect(create.mock.calls[0][0].line_items[0].quantity).toBe(99);
  });

  it("requires an in-stock size for a sized item and names it on the line", async () => {
    mockListVariants.mockResolvedValue([
      variant({
        name: "Keyhole Dress",
        sizes: [
          { name: "Adult S", available: true },
          { name: "Adult M", available: false },
        ],
      }),
    ]);
    const { stripe, create } = fakeStripe();

    // No size chosen -> rejected.
    await expect(
      createCheckoutSession([{ variantId: "v1", quantity: 1 }], stripe),
    ).rejects.toBeInstanceOf(BadRequestError);

    // A sold-out size -> rejected.
    await expect(
      createCheckoutSession(
        [{ variantId: "v1", size: "Adult M", quantity: 1 }],
        stripe,
      ),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(create).not.toHaveBeenCalled();

    // An in-stock size -> accepted, size appended to the product name.
    await createCheckoutSession(
      [{ variantId: "v1", size: "Adult S", quantity: 1 }],
      stripe,
    );
    // The size rides on the metadata as well as the display name, so the
    // webhook can band the order line without parsing it back out of a string.
    expect(
      create.mock.calls[0][0].line_items[0].price_data.product_data,
    ).toEqual({
      name: "Keyhole Dress — Adult S",
      metadata: { variantId: "v1", size: "Adult S" },
    });
  });

  it("offers the configured Stripe shipping rates, trimmed, in order", async () => {
    process.env.STRIPE_SHIPPING_RATE_IDS = "shr_standard, shr_express";
    mockListVariants.mockResolvedValue([variant()]);
    const { stripe, create } = fakeStripe();

    await createCheckoutSession([{ variantId: "v1", quantity: 1 }], stripe);

    expect(create.mock.calls[0][0].shipping_options).toEqual([
      { shipping_rate: "shr_standard" },
      { shipping_rate: "shr_express" },
    ]);
    // Address collection stays on so Stripe can ship / apply the rate.
    expect(create.mock.calls[0][0].shipping_address_collection).toEqual({
      allowed_countries: ["US", "CA"],
    });
  });

  it("omits shipping_options entirely when no rates are configured", async () => {
    mockListVariants.mockResolvedValue([variant()]);
    const { stripe, create, retrieveShippingRate } = fakeStripe();

    await createCheckoutSession([{ variantId: "v1", quantity: 1 }], stripe);

    expect(create.mock.calls[0][0].shipping_options).toBeUndefined();
    // No configured ids -> never round-trips to Stripe to validate them.
    expect(retrieveShippingRate).not.toHaveBeenCalled();
  });

  it("drops a shipping rate Stripe can't resolve and keeps the valid ones", async () => {
    process.env.STRIPE_SHIPPING_RATE_IDS = "shr_missing, shr_ok";
    mockListVariants.mockResolvedValue([variant()]);
    const { stripe, create, retrieveShippingRate } = fakeStripe();
    // The first id is gone (deleted / wrong Stripe mode); the second is valid.
    retrieveShippingRate.mockImplementation((id: string) =>
      id === "shr_missing"
        ? Promise.reject(new Error("No such shipping rate: 'shr_missing'"))
        : Promise.resolve({
            id,
            active: true,
            fixed_amount: { currency: "usd" },
          }),
    );

    await createCheckoutSession([{ variantId: "v1", quantity: 1 }], stripe);

    // Checkout still succeeds, offering only the resolvable rate.
    expect(create.mock.calls[0][0].shipping_options).toEqual([
      { shipping_rate: "shr_ok" },
    ]);
    expect(logger.error).toHaveBeenCalled();
  });

  it("drops an archived (inactive) shipping rate", async () => {
    process.env.STRIPE_SHIPPING_RATE_IDS = "shr_archived, shr_ok";
    mockListVariants.mockResolvedValue([variant()]);
    const { stripe, create, retrieveShippingRate } = fakeStripe();
    retrieveShippingRate.mockImplementation((id: string) =>
      Promise.resolve({
        id,
        active: id !== "shr_archived",
        fixed_amount: { currency: "usd" },
      }),
    );

    await createCheckoutSession([{ variantId: "v1", quantity: 1 }], stripe);

    expect(create.mock.calls[0][0].shipping_options).toEqual([
      { shipping_rate: "shr_ok" },
    ]);
    expect(logger.error).toHaveBeenCalled();
  });

  it("drops a shipping rate priced in a non-USD currency", async () => {
    process.env.STRIPE_SHIPPING_RATE_IDS = "shr_cad, shr_ok";
    mockListVariants.mockResolvedValue([variant()]);
    const { stripe, create, retrieveShippingRate } = fakeStripe();
    retrieveShippingRate.mockImplementation((id: string) =>
      Promise.resolve({
        id,
        active: true,
        fixed_amount: { currency: id === "shr_cad" ? "cad" : "usd" },
      }),
    );

    await createCheckoutSession([{ variantId: "v1", quantity: 1 }], stripe);

    expect(create.mock.calls[0][0].shipping_options).toEqual([
      { shipping_rate: "shr_ok" },
    ]);
    expect(logger.error).toHaveBeenCalled();
  });

  it("omits shipping_options when every configured rate is invalid (still checks out)", async () => {
    process.env.STRIPE_SHIPPING_RATE_IDS = "shr_missing";
    mockListVariants.mockResolvedValue([variant()]);
    const { stripe, create, retrieveShippingRate } = fakeStripe();
    retrieveShippingRate.mockRejectedValue(
      new Error("No such shipping rate: 'shr_missing'"),
    );

    await createCheckoutSession([{ variantId: "v1", quantity: 1 }], stripe);

    // A single stale id no longer 500s the whole checkout: the session is
    // created with no shipping options (charging $0 shipping) and it's logged.
    expect(create).toHaveBeenCalled();
    expect(create.mock.calls[0][0].shipping_options).toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });

  it("offers the configured buy-now-pay-later methods (card + BNPL) when set", async () => {
    process.env.STRIPE_BNPL_METHODS = "klarna, affirm";
    mockListVariants.mockResolvedValue([variant()]);
    const { stripe, create } = fakeStripe();

    await createCheckoutSession([{ variantId: "v1", quantity: 1 }], stripe);

    expect(create.mock.calls[0][0].payment_method_types).toEqual([
      "card",
      "klarna",
      "affirm",
    ]);
  });

  it("omits payment_method_types when no BNPL is configured (dynamic methods)", async () => {
    mockListVariants.mockResolvedValue([variant()]);
    const { stripe, create } = fakeStripe();

    await createCheckoutSession([{ variantId: "v1", quantity: 1 }], stripe);

    expect(create.mock.calls[0][0].payment_method_types).toBeUndefined();
  });

  it("throws when PUBLIC_BASE_URL is not configured", async () => {
    delete process.env.PUBLIC_BASE_URL;
    mockListVariants.mockResolvedValue([variant()]);
    const { stripe } = fakeStripe();

    await expect(
      createCheckoutSession([{ variantId: "v1", quantity: 1 }], stripe),
    ).rejects.toThrow(/PUBLIC_BASE_URL/);
  });

  it("rejects an empty cart before touching inventory or Stripe", async () => {
    const { stripe, create } = fakeStripe();

    await expect(createCheckoutSession([], stripe)).rejects.toBeInstanceOf(
      BadRequestError,
    );
    expect(mockListVariants).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("throws when Stripe returns a session without a URL", async () => {
    mockListVariants.mockResolvedValue([variant()]);
    const { stripe, create } = fakeStripe();
    create.mockResolvedValue({ url: null });

    await expect(
      createCheckoutSession([{ variantId: "v1", quantity: 1 }], stripe),
    ).rejects.toThrow(/Stripe did not return a checkout URL/);
  });
});

describe("getCheckoutSession", () => {
  it("retrieves the session with line items expanded and maps a full receipt to dollars", async () => {
    const { stripe, retrieve } = fakeStripe();
    retrieve.mockResolvedValue({
      payment_status: "paid",
      currency: "usd",
      customer_details: { email: "buyer@example.com" },
      line_items: {
        data: [
          {
            description: "Keyhole Dress — Adult S",
            quantity: 1,
            amount_total: 12500,
          },
          { description: "Bow Fleece Soaker", quantity: 2, amount_total: 4400 },
        ],
      },
      amount_subtotal: 16900,
      total_details: { amount_shipping: 800, amount_tax: 1400 },
      amount_total: 19100,
    });

    const view = await getCheckoutSession("cs_123", stripe);

    expect(retrieve).toHaveBeenCalledWith("cs_123", {
      expand: ["line_items"],
    });
    expect(view).toEqual({
      status: "paid",
      email: "buyer@example.com",
      currency: "usd",
      lineItems: [
        { description: "Keyhole Dress — Adult S", quantity: 1, amount: 125 },
        { description: "Bow Fleece Soaker", quantity: 2, amount: 44 },
      ],
      amountSubtotal: 169,
      amountShipping: 8,
      amountTax: 14,
      amountTotal: 191,
    });
  });

  it("omits optional fields and zeroes amounts for a bare session", async () => {
    const { stripe, retrieve } = fakeStripe();
    // No email, no currency, no line items, no totals.
    retrieve.mockResolvedValue({ payment_status: "unpaid" });

    const view = await getCheckoutSession("cs_bare", stripe);

    expect(view).toEqual({
      status: "unpaid",
      amountSubtotal: 0,
      amountShipping: 0,
      amountTax: 0,
      amountTotal: 0,
    });
    expect(view.email).toBeUndefined();
    expect(view.currency).toBeUndefined();
    expect(view.lineItems).toBeUndefined();
  });

  it("falls back to defaults for a line item missing a description or quantity", async () => {
    const { stripe, retrieve } = fakeStripe();
    retrieve.mockResolvedValue({
      payment_status: "paid",
      line_items: { data: [{ amount_total: 5000 }] },
    });

    const view = await getCheckoutSession("cs_partial", stripe);

    expect(view.lineItems).toEqual([
      { description: "Item", quantity: 1, amount: 50 },
    ]);
  });

  it("surfaces the session kind from metadata (so the success page can skip clearing a deposit's cart)", async () => {
    const { stripe, retrieve } = fakeStripe();
    retrieve.mockResolvedValue({
      payment_status: "paid",
      metadata: { kind: "deposit" },
    });

    const view = await getCheckoutSession("cs_deposit", stripe);
    expect(view.kind).toBe("deposit");
  });

  it("maps a Stripe 'no such session' error to a NotFoundError (404, not an unhandled 500)", async () => {
    const { stripe, retrieve } = fakeStripe();
    // A non-Stripe id (e.g. a deposit marked paid in person with an "IN_PERSON"
    // marker in the invoice's Session Id field) reaches Stripe from the URL.
    retrieve.mockRejectedValue(
      Object.assign(new Error("No such checkout.session: IN_PERSON"), {
        type: "StripeInvalidRequestError",
        code: "resource_missing",
        statusCode: 404,
      }),
    );

    await expect(
      getCheckoutSession("IN_PERSON", stripe),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rethrows an unexpected Stripe error (not a missing session) untouched", async () => {
    const { stripe, retrieve } = fakeStripe();
    retrieve.mockRejectedValue(
      Object.assign(new Error("Stripe is down"), {
        type: "StripeAPIError",
        statusCode: 500,
      }),
    );

    await expect(getCheckoutSession("cs_boom", stripe)).rejects.toThrow(
      /Stripe is down/,
    );
  });
});

describe("recordPaidOrder", () => {
  it("records a paid session as a new Notion order", async () => {
    mockFind.mockResolvedValue(false);
    const fullSession = {
      id: "cs_1",
      payment_status: "paid",
      line_items: { data: [] },
    } as unknown as Stripe.Checkout.Session;
    const { stripe, retrieve } = fakeStripe();
    retrieve.mockResolvedValue(fullSession);

    await recordPaidOrder({ id: "cs_1" } as Stripe.Checkout.Session, stripe);

    expect(retrieve).toHaveBeenCalledWith("cs_1", {
      // The product carries the `variantId` we stamped at checkout; the shipping
      // rate carries the display name that tells a local pickup from a posting.
      expand: ["line_items.data.price.product", "shipping_cost.shipping_rate"],
    });
    // No customer email on this session -> no CRM upsert, no client link.
    expect(mockUpsertClient).not.toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledWith(
      fullSession,
      undefined,
      undefined,
      undefined,
    );
  });

  it("relates the order to inventory rows (deduped) when NOTION_RELATION_LINKS is on", async () => {
    process.env.NOTION_RELATION_LINKS = "1";
    mockFind.mockResolvedValue(false);
    const fullSession = {
      id: "cs_items",
      payment_status: "paid",
      line_items: {
        data: [
          { price: { product: { metadata: { variantId: "inv-a" } } } },
          { price: { product: { metadata: { variantId: "inv-b" } } } },
          // A second line of the same item links once (deduped).
          { price: { product: { metadata: { variantId: "inv-a" } } } },
          // A line with no metadata (legacy/ad-hoc) contributes nothing.
          { price: { product: { metadata: {} } } },
        ],
      },
    } as unknown as Stripe.Checkout.Session;
    const { stripe, retrieve } = fakeStripe();
    retrieve.mockResolvedValue(fullSession);

    await recordPaidOrder(
      { id: "cs_items" } as Stripe.Checkout.Session,
      stripe,
    );

    expect(mockCreate).toHaveBeenCalledWith(fullSession, undefined, undefined, [
      "inv-a",
      "inv-b",
    ]);
    delete process.env.NOTION_RELATION_LINKS;
  });

  // Writing these line rows IS the stock decrement: the inventory's
  // `Units Sold (auto)` rollup sums them through each line's `Item` relation.
  it("writes one order line per purchased item so inventory decrements", async () => {
    mockFind.mockResolvedValue(false);
    mockCreate.mockResolvedValue("order-page");
    mockOrderLinesConfigured.mockReturnValue(true);
    const fullSession = {
      id: "cs_lines",
      payment_status: "paid",
      line_items: {
        data: [
          {
            description: "Keyhole Dress — Adult S",
            quantity: 2,
            amount_subtotal: 24000,
            price: {
              unit_amount: 12000,
              product: { metadata: { variantId: "inv-a", size: "Adult S" } },
            },
          },
          {
            description: "Blade Towel",
            quantity: 1,
            amount_subtotal: 1200,
            price: {
              unit_amount: 1200,
              product: { metadata: { variantId: "inv-b" } },
            },
          },
        ],
      },
    } as unknown as Stripe.Checkout.Session;
    const { stripe, retrieve } = fakeStripe();
    retrieve.mockResolvedValue(fullSession);

    await recordPaidOrder(
      { id: "cs_lines" } as Stripe.Checkout.Session,
      stripe,
    );

    expect(mockCreateOrderLine).toHaveBeenCalledTimes(2);
    expect(mockCreateOrderLine).toHaveBeenCalledWith({
      orderPageId: "order-page",
      itemPageId: "inv-a",
      name: "Keyhole Dress — Adult S",
      quantity: 2,
      unitPrice: 120,
      size: "Adult S",
    });
    expect(mockCreateOrderLine).toHaveBeenCalledWith({
      orderPageId: "order-page",
      itemPageId: "inv-b",
      name: "Blade Towel",
      quantity: 1,
      unitPrice: 12,
    });
  });

  it("records the order without lines when the order-lines database is unset", async () => {
    mockFind.mockResolvedValue(false);
    mockOrderLinesConfigured.mockReturnValue(false);
    const fullSession = {
      id: "cs_nolines",
      payment_status: "paid",
      line_items: {
        data: [{ price: { product: { metadata: { variantId: "inv-a" } } } }],
      },
    } as unknown as Stripe.Checkout.Session;
    const { stripe, retrieve } = fakeStripe();
    retrieve.mockResolvedValue(fullSession);

    await recordPaidOrder(
      { id: "cs_nolines" } as Stripe.Checkout.Session,
      stripe,
    );

    expect(mockCreate).toHaveBeenCalled();
    expect(mockCreateOrderLine).not.toHaveBeenCalled();
  });

  it("omits the inventory relation when the gate is off, even with metadata present", async () => {
    mockFind.mockResolvedValue(false);
    const fullSession = {
      id: "cs_items_off",
      payment_status: "paid",
      line_items: {
        data: [{ price: { product: { metadata: { variantId: "inv-a" } } } }],
      },
    } as unknown as Stripe.Checkout.Session;
    const { stripe, retrieve } = fakeStripe();
    retrieve.mockResolvedValue(fullSession);

    await recordPaidOrder(
      { id: "cs_items_off" } as Stripe.Checkout.Session,
      stripe,
    );

    expect(mockCreate).toHaveBeenCalledWith(
      fullSession,
      undefined,
      undefined,
      undefined,
    );
  });

  it("upserts the buyer into the Client CRM (Active) and links the order to it", async () => {
    mockFind.mockResolvedValue(false);
    mockUpsertClient.mockResolvedValue("client-9");
    const fullSession = {
      id: "cs_crm",
      payment_status: "paid",
      customer_details: { email: "buyer@example.com", name: "Ada Lovelace" },
      line_items: { data: [] },
    } as unknown as Stripe.Checkout.Session;
    const { stripe, retrieve } = fakeStripe();
    retrieve.mockResolvedValue(fullSession);

    await recordPaidOrder({ id: "cs_crm" } as Stripe.Checkout.Session, stripe);

    // Dedupe by the buyer's email; a new buyer is an Active client (default).
    expect(mockUpsertClient).toHaveBeenCalledWith({
      fullName: "Ada Lovelace",
      email: "buyer@example.com",
    });
    // The resolved client page id is threaded into the shop-order write.
    expect(mockCreate).toHaveBeenCalledWith(
      fullSession,
      undefined,
      "client-9",
      undefined,
    );
  });

  it("still records the order (unlinked) when the CRM upsert fails", async () => {
    mockFind.mockResolvedValue(false);
    mockUpsertClient.mockRejectedValue(new Error("Notion CRM down"));
    const fullSession = {
      id: "cs_crm_fail",
      payment_status: "paid",
      customer_details: { email: "buyer@example.com", name: "Ada" },
      line_items: { data: [] },
    } as unknown as Stripe.Checkout.Session;
    const { stripe, retrieve } = fakeStripe();
    retrieve.mockResolvedValue(fullSession);

    await recordPaidOrder(
      { id: "cs_crm_fail" } as Stripe.Checkout.Session,
      stripe,
    );

    // A CRM failure never fails the webhook; the order is recorded unlinked.
    expect(mockCreate).toHaveBeenCalledWith(
      fullSession,
      undefined,
      undefined,
      undefined,
    );
  });

  it("runs the reward passes with the buyer email + order number after recording", async () => {
    mockFind.mockResolvedValue(false);
    const fullSession = {
      id: "cs_rw",
      payment_status: "paid",
      customer_details: { email: "buyer@example.com", name: "Ada" },
      metadata: { kind: "shop", orderNumber: "SHP-123" },
      line_items: { data: [] },
    } as unknown as Stripe.Checkout.Session;
    const { stripe, retrieve } = fakeStripe();
    retrieve.mockResolvedValue(fullSession);

    await recordPaidOrder({ id: "cs_rw" } as Stripe.Checkout.Session, stripe);

    expect(mockRewards).toHaveBeenCalledWith("buyer@example.com", "SHP-123");
  });

  it("still records the order when the reward pass throws (best-effort)", async () => {
    mockFind.mockResolvedValue(false);
    mockRewards.mockRejectedValueOnce(new Error("reward boom"));
    const fullSession = {
      id: "cs_rw_boom",
      payment_status: "paid",
      customer_details: { email: "buyer@example.com", name: "Ada" },
      metadata: { kind: "shop", orderNumber: "SHP-999" },
      line_items: { data: [] },
    } as unknown as Stripe.Checkout.Session;
    const { stripe, retrieve } = fakeStripe();
    retrieve.mockResolvedValue(fullSession);

    // Must not throw — a reward failure can't 500 the webhook.
    await expect(
      recordPaidOrder({ id: "cs_rw_boom" } as Stripe.Checkout.Session, stripe),
    ).resolves.toBeUndefined();
    expect(mockCreate).toHaveBeenCalled();
  });

  it("is idempotent — skips an already-recorded session without retrieving it", async () => {
    mockFind.mockResolvedValue(true);
    const { stripe, retrieve } = fakeStripe();

    await recordPaidOrder({ id: "cs_dup" } as Stripe.Checkout.Session, stripe);

    expect(retrieve).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("does not record a session that isn't paid", async () => {
    mockFind.mockResolvedValue(false);
    const { stripe, retrieve } = fakeStripe();
    retrieve.mockResolvedValue({
      id: "cs_2",
      payment_status: "unpaid",
      line_items: { data: [] },
    } as unknown as Stripe.Checkout.Session);

    await recordPaidOrder({ id: "cs_2" } as Stripe.Checkout.Session, stripe);

    expect(mockCreate).not.toHaveBeenCalled();
    // No record -> no confirmation email.
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("sends a best-effort confirmation email to the customer after recording", async () => {
    mockFind.mockResolvedValue(false);
    const fullSession = {
      id: "cs_email",
      payment_status: "paid",
      customer_details: { email: "buyer@example.com", name: "Ada Lovelace" },
      metadata: { kind: "shop", orderNumber: "SHP-XYZ-9999" },
      line_items: {
        data: [
          { description: "Bow Fleece Soaker", quantity: 1, amount_total: 2200 },
        ],
      },
      amount_subtotal: 2200,
      total_details: { amount_shipping: 0, amount_tax: 0 },
      amount_total: 2200,
    } as unknown as Stripe.Checkout.Session;
    const { stripe, retrieve } = fakeStripe();
    retrieve.mockResolvedValue(fullSession);

    await recordPaidOrder(
      { id: "cs_email" } as Stripe.Checkout.Session,
      stripe,
    );

    expect(mockCreate).toHaveBeenCalledWith(
      fullSession,
      undefined,
      undefined,
      undefined,
    );
    // Customer confirmation dispatched, from the orders sender.
    expect(mockSend).toHaveBeenCalledTimes(1);
    const message = mockSend.mock.calls[0][0];
    expect(message.to).toBe("buyer@example.com");
    expect(message.from).toBe("orders@shop.test");
    expect(message.subject).toMatch(/order is confirmed/i);
    // The order number (from session metadata) rides on the email.
    expect(message.text).toContain("SHP-XYZ-9999");
  });

  it("also notifies the atelier when ATELIER_INBOX_EMAIL is set", async () => {
    process.env.ATELIER_INBOX_EMAIL = "studio@shop.test";
    mockFind.mockResolvedValue(false);
    const fullSession = {
      id: "cs_email2",
      payment_status: "paid",
      customer_details: { email: "buyer@example.com", name: "Ada" },
      line_items: {
        data: [{ description: "Soaker", quantity: 1, amount_total: 2200 }],
      },
      amount_subtotal: 2200,
      total_details: {},
      amount_total: 2200,
    } as unknown as Stripe.Checkout.Session;
    const { stripe, retrieve } = fakeStripe();
    retrieve.mockResolvedValue(fullSession);

    await recordPaidOrder(
      { id: "cs_email2" } as Stripe.Checkout.Session,
      stripe,
    );

    // Two sends: the customer confirmation and the atelier notification, which
    // replies to the customer.
    expect(mockSend).toHaveBeenCalledTimes(2);
    const atelier = mockSend.mock.calls.find(
      (call) => call[0].to === "studio@shop.test",
    );
    expect(atelier).toBeDefined();
    expect(atelier?.[0].replyTo).toBe("buyer@example.com");
  });

  it("skips the confirmation email when the session has no customer email", async () => {
    mockFind.mockResolvedValue(false);
    const { stripe, retrieve } = fakeStripe();
    retrieve.mockResolvedValue({
      id: "cs_noemail",
      payment_status: "paid",
      line_items: { data: [] },
    } as unknown as Stripe.Checkout.Session);

    await recordPaidOrder(
      { id: "cs_noemail" } as Stripe.Checkout.Session,
      stripe,
    );

    expect(mockCreate).toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe("recordPaidOrder (Postgres dedup)", () => {
  const paidSession = {
    id: "cs_pg",
    payment_status: "paid",
    line_items: { data: [] },
  } as unknown as Stripe.Checkout.Session;

  afterEach(() => {
    delete process.env.POSTGRES_URL;
    __resetDb();
  });

  /** A fake db that resolves the claim to a given outcome. */
  function claimDb(result: "claimed" | "done" | "in_progress") {
    return makeFakeDb((text) => {
      if (text.includes("insert into processed_payments"))
        return result === "claimed" ? [{ stripe_session_id: "cs_pg" }] : [];
      if (text.includes("select status"))
        return result === "done"
          ? [{ status: "done", stale: false }]
          : [{ status: "processing", stale: false }];
      return [];
    });
  }

  it("claims, records, then confirms a paid session", async () => {
    process.env.POSTGRES_URL = "postgres://test";
    const db = claimDb("claimed");
    __setDbForTests(db);
    mockFind.mockResolvedValue(false);
    const { stripe, retrieve } = fakeStripe();
    retrieve.mockResolvedValue(paidSession);

    await recordPaidOrder({ id: "cs_pg" } as Stripe.Checkout.Session, stripe);

    expect(mockCreate).toHaveBeenCalled();
    // The claim was confirmed (status set to done).
    expect(db.calls.some((c) => /status = 'done'/.test(c.text))).toBe(true);
  });

  it("no-ops a redelivered, already-done session (no retrieve/create)", async () => {
    process.env.POSTGRES_URL = "postgres://test";
    __setDbForTests(claimDb("done"));
    const { stripe, retrieve } = fakeStripe();

    await recordPaidOrder({ id: "cs_pg" } as Stripe.Checkout.Session, stripe);

    expect(retrieve).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("throws (→ webhook 500 → Stripe retry) when a peer is mid-flight", async () => {
    process.env.POSTGRES_URL = "postgres://test";
    __setDbForTests(claimDb("in_progress"));
    const { stripe } = fakeStripe();

    await expect(
      recordPaidOrder({ id: "cs_pg" } as Stripe.Checkout.Session, stripe),
    ).rejects.toThrow(/already being processed/);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("releases the claim and rethrows when recording fails mid-flight", async () => {
    process.env.POSTGRES_URL = "postgres://test";
    const db = claimDb("claimed");
    __setDbForTests(db);
    mockFind.mockResolvedValue(false);
    mockCreate.mockRejectedValueOnce(new Error("Notion down"));
    const { stripe, retrieve } = fakeStripe();
    retrieve.mockResolvedValue(paidSession);

    await expect(
      recordPaidOrder({ id: "cs_pg" } as Stripe.Checkout.Session, stripe),
    ).rejects.toThrow("Notion down");
    expect(
      db.calls.some((c) => /delete from processed_payments/.test(c.text)),
    ).toBe(true);
  });

  it("falls back to Notion dedup when the claim itself errors (DB blip)", async () => {
    process.env.POSTGRES_URL = "postgres://test";
    __setDbForTests(
      makeFakeDb(() => {
        throw new Error("db unreachable");
      }),
    );
    mockFind.mockResolvedValue(false);
    const { stripe, retrieve } = fakeStripe();
    retrieve.mockResolvedValue(paidSession);

    await recordPaidOrder({ id: "cs_pg" } as Stripe.Checkout.Session, stripe);

    // Degraded to the legacy path — the order is still recorded.
    expect(mockCreate).toHaveBeenCalled();
  });
});
