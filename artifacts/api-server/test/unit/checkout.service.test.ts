import { describe, it, expect, vi, beforeEach } from "vitest";

// The service resolves the cart against live inventory and records paid orders
// via these adapters; both are mocked so the tests stay pure (no Notion/Stripe).
vi.mock("../../src/lib/notion/products.repository.js", () => ({
  listVariants: vi.fn(),
}));
vi.mock("../../src/lib/notion/shop-orders.repository.js", () => ({
  findOrderBySessionId: vi.fn(),
  createShopOrder: vi.fn(),
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

import type Stripe from "stripe";
import {
  createCheckoutSession,
  getCheckoutSession,
  recordPaidOrder,
} from "../../src/services/checkout.service.js";
import { BadRequestError } from "../../src/lib/errors.js";
import { logger } from "../../src/lib/logger.js";
import { listVariants } from "../../src/lib/notion/products.repository.js";
import {
  createShopOrder,
  findOrderBySessionId,
} from "../../src/lib/notion/shop-orders.repository.js";
import { upsertClientByEmail } from "../../src/lib/notion/clients.repository.js";
import { sendEmailBestEffort } from "../../src/lib/resend/send.js";
import type { VariantRecord } from "../../src/lib/notion/products.schema.js";

const mockListVariants = vi.mocked(listVariants);
const mockFind = vi.mocked(findOrderBySessionId);
const mockCreate = vi.mocked(createShopOrder);
const mockUpsertClient = vi.mocked(upsertClientByEmail);
const mockSend = vi.mocked(sendEmailBestEffort);

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
          product_data: { name: "Bow Fleece Soaker" },
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
    expect(
      create.mock.calls[0][0].line_items[0].price_data.product_data,
    ).toEqual({ name: "Keyhole Dress — Adult S" });
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

    expect(retrieve).toHaveBeenCalledWith("cs_1", { expand: ["line_items"] });
    // No customer email on this session -> no CRM upsert, no client link.
    expect(mockUpsertClient).not.toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledWith(fullSession, undefined, undefined);
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
    expect(mockCreate).toHaveBeenCalledWith(fullSession, undefined, "client-9");
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
    expect(mockCreate).toHaveBeenCalledWith(fullSession, undefined, undefined);
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

    expect(mockCreate).toHaveBeenCalledWith(fullSession, undefined, undefined);
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
