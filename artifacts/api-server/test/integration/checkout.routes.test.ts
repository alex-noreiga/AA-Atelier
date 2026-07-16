import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Stripe client and the inventory reader so the HTTP stack (routing →
// validation → service → response schema parse → error handler) runs end-to-end
// without the network.
vi.mock("../../src/lib/stripe/client.js", () => ({ getStripeClient: vi.fn() }));
vi.mock("../../src/lib/notion/products.repository.js", () => ({
  listVariants: vi.fn(),
}));

import request from "supertest";
import type Stripe from "stripe";
import app from "../../src/app.js";
import { logger } from "../../src/lib/logger.js";
import { getStripeClient } from "../../src/lib/stripe/client.js";
import { listVariants } from "../../src/lib/notion/products.repository.js";
import type { VariantRecord } from "../../src/lib/notion/products.schema.js";

const mockGetStripe = vi.mocked(getStripeClient);
const mockListVariants = vi.mocked(listVariants);

function variant(overrides: Partial<VariantRecord> = {}): VariantRecord {
  return {
    id: "v1",
    name: "Bow Fleece Soaker",
    available: true,
    price: 22,
    photos: [],
    sizes: [],
    category: "Soaker",
    group: null,
    ...overrides,
  };
}

function stubStripe(overrides: {
  create?: ReturnType<typeof vi.fn>;
  retrieve?: ReturnType<typeof vi.fn>;
  retrieveShippingRate?: ReturnType<typeof vi.fn>;
}) {
  mockGetStripe.mockReturnValue({
    checkout: {
      sessions: {
        create: overrides.create ?? vi.fn(),
        retrieve: overrides.retrieve ?? vi.fn(),
      },
    },
    // Default: configured shipping rates resolve as valid, active USD rates.
    shippingRates: {
      retrieve:
        overrides.retrieveShippingRate ??
        vi
          .fn()
          .mockImplementation((id: string) =>
            Promise.resolve({
              id,
              active: true,
              fixed_amount: { currency: "usd" },
            }),
          ),
    },
  } as unknown as Stripe);
}

beforeEach(() => {
  process.env.PUBLIC_BASE_URL = "https://shop.test";
  delete process.env.STRIPE_SHIPPING_RATE_IDS;
  vi.spyOn(logger, "error").mockImplementation(() => logger);
});

describe("POST /api/checkout", () => {
  it("returns 201 { url } for a valid, in-stock, priced cart", async () => {
    mockListVariants.mockResolvedValue([variant()]);
    stubStripe({
      create: vi
        .fn()
        .mockResolvedValue({ url: "https://checkout.stripe.test/x" }),
    });

    const res = await request(app)
      .post("/api/checkout")
      .send({ items: [{ variantId: "v1", quantity: 1 }] });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ url: "https://checkout.stripe.test/x" });
  });

  it("passes the configured shipping rates through to Stripe", async () => {
    process.env.STRIPE_SHIPPING_RATE_IDS = "shr_standard";
    mockListVariants.mockResolvedValue([variant()]);
    const create = vi
      .fn()
      .mockResolvedValue({ url: "https://checkout.stripe.test/x" });
    stubStripe({ create });

    await request(app)
      .post("/api/checkout")
      .send({ items: [{ variantId: "v1", quantity: 1 }] });

    expect(create.mock.calls[0][0].shipping_options).toEqual([
      { shipping_rate: "shr_standard" },
    ]);
  });

  it("still returns 201 when a configured shipping rate can't be resolved", async () => {
    // Regression: a stale/wrong-mode STRIPE_SHIPPING_RATE_IDS used to make Stripe
    // reject sessions.create, 500-ing every checkout. The bad rate is now dropped.
    process.env.STRIPE_SHIPPING_RATE_IDS = "shr_dead";
    mockListVariants.mockResolvedValue([variant()]);
    const create = vi
      .fn()
      .mockResolvedValue({ url: "https://checkout.stripe.test/x" });
    stubStripe({
      create,
      retrieveShippingRate: vi
        .fn()
        .mockRejectedValue(new Error("No such shipping rate: 'shr_dead'")),
    });

    const res = await request(app)
      .post("/api/checkout")
      .send({ items: [{ variantId: "v1", quantity: 1 }] });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ url: "https://checkout.stripe.test/x" });
    // Session created with no shipping option rather than failing outright.
    expect(create.mock.calls[0][0].shipping_options).toBeUndefined();
  });

  it("returns 400 with a customer-safe message for a sold-out item", async () => {
    const create = vi.fn();
    mockListVariants.mockResolvedValue([variant({ available: false })]);
    stubStripe({ create });

    const res = await request(app)
      .post("/api/checkout")
      .send({ items: [{ variantId: "v1", quantity: 1 }] });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(create).not.toHaveBeenCalled();
  });

  it("returns 400 with a customer-safe message when the quantity exceeds stock", async () => {
    const create = vi.fn();
    mockListVariants.mockResolvedValue([variant({ quantityAvailable: 2 })]);
    stubStripe({ create });

    const res = await request(app)
      .post("/api/checkout")
      .send({ items: [{ variantId: "v1", quantity: 3 }] });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(create).not.toHaveBeenCalled();
  });

  it("returns 400 when the cart is empty (schema violation)", async () => {
    const res = await request(app).post("/api/checkout").send({ items: [] });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });
});

describe("GET /api/checkout/session/:sessionId", () => {
  it("returns the status, email, and an itemized receipt (cents -> dollars)", async () => {
    const retrieve = vi.fn().mockResolvedValue({
      payment_status: "paid",
      customer_details: { email: "ada@example.com" },
      currency: "usd",
      amount_subtotal: 4400,
      amount_total: 5308,
      total_details: { amount_shipping: 800, amount_tax: 108 },
      line_items: {
        data: [
          { description: "Bow Fleece Soaker", quantity: 2, amount_total: 4400 },
        ],
      },
    });
    stubStripe({ retrieve });

    const res = await request(app).get("/api/checkout/session/cs_test_1");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: "paid",
      email: "ada@example.com",
      currency: "usd",
      lineItems: [
        { description: "Bow Fleece Soaker", quantity: 2, amount: 44 },
      ],
      amountSubtotal: 44,
      amountShipping: 8,
      amountTax: 1.08,
      amountTotal: 53.08,
    });
    // Line items are expanded so the receipt can be rendered.
    expect(retrieve).toHaveBeenCalledWith("cs_test_1", {
      expand: ["line_items"],
    });
  });
});
