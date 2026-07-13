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
}) {
  mockGetStripe.mockReturnValue({
    checkout: {
      sessions: {
        create: overrides.create ?? vi.fn(),
        retrieve: overrides.retrieve ?? vi.fn(),
      },
    },
  } as unknown as Stripe);
}

beforeEach(() => {
  process.env.PUBLIC_BASE_URL = "https://shop.test";
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

  it("returns 400 when the cart is empty (schema violation)", async () => {
    const res = await request(app).post("/api/checkout").send({ items: [] });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });
});

describe("GET /api/checkout/session/:sessionId", () => {
  it("returns the payment status and email", async () => {
    stubStripe({
      retrieve: vi.fn().mockResolvedValue({
        payment_status: "paid",
        customer_details: { email: "ada@example.com" },
      }),
    });

    const res = await request(app).get("/api/checkout/session/cs_test_1");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "paid", email: "ada@example.com" });
  });
});
