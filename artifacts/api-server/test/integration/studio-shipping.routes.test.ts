import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The order lookup, the tracking writer, the vendor and Stripe are mocked; the
// real route, validation, auth and service stack runs over them.
vi.mock("../../src/lib/notion/shop-orders.repository.js", () => ({
  findShopOrderForShipping: vi.fn(),
  recordShopOrderTracking: vi.fn(),
}));
vi.mock("../../src/lib/shippo/labels.repository.js", () => ({
  fetchShippingRates: vi.fn(),
  purchaseLabel: vi.fn(),
}));
vi.mock("../../src/lib/stripe/client.js", () => ({
  getStripeClient: vi.fn(),
}));

import request from "supertest";
import type Stripe from "stripe";
import app from "../../src/app.js";
import {
  findShopOrderForShipping,
  recordShopOrderTracking,
} from "../../src/lib/notion/shop-orders.repository.js";
import {
  fetchShippingRates,
  purchaseLabel,
} from "../../src/lib/shippo/labels.repository.js";
import { getStripeClient } from "../../src/lib/stripe/client.js";
import {
  __setSupabaseClientForTests,
  __resetSupabaseClient,
} from "../../src/lib/supabase/client.js";
import {
  makeFakeSupabaseClient,
  asSupabaseClient,
  type FakeClaims,
} from "../support/fake-supabase.js";
import { __resetSettings } from "../../src/lib/settings/store.js";
import { SHIP_FROM_KEYS } from "../../src/lib/shipping/from-address.js";

const mockFind = vi.mocked(findShopOrderForShipping);
const mockRecord = vi.mocked(recordShopOrderTracking);
const mockRates = vi.mocked(fetchShippingRates);
const mockBuy = vi.mocked(purchaseLabel);
const mockStripe = vi.mocked(getStripeClient);

const STAFF = "alexandra@a3iceanddance.com";
const GOOGLE_STAFF: FakeClaims = {
  email: STAFF,
  sub: "user-1",
  amr: [{ method: "oauth", timestamp: 1_700_000_000 }],
};

function acceptToken(validToken: string, claims: FakeClaims): void {
  __setSupabaseClientForTests(
    asSupabaseClient(
      makeFakeSupabaseClient((token) =>
        token === validToken
          ? { data: { claims }, error: null }
          : { data: null, error: { message: "invalid token" } },
      ),
    ),
  );
}

const RATE = {
  id: "rate_1",
  carrier: "USPS",
  service: "Ground Advantage",
  amount: 7.45,
  currency: "USD",
};

const savedEnv = new Map<string, string | undefined>();

beforeEach(() => {
  process.env.SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_ANON_KEY = "anon-test-key";
  process.env.STUDIO_STAFF_EMAILS = STAFF;
  delete process.env.STUDIO_REQUIRE_GOOGLE;

  __resetSettings();
  for (const key of [...SHIP_FROM_KEYS, "SHIPPO_API_KEY"]) {
    savedEnv.set(key, process.env[key]);
    delete process.env[key];
  }
  process.env.SHIPPO_API_KEY = "shippo_test_abc123";
  // The ship-from address is seeded through the ENVIRONMENT rather than the
  // settings snapshot, because this stack runs the real `primeSettings`
  // middleware: it re-reads the (unconfigured, therefore empty) Studio Settings
  // database on every request and would wipe a seeded snapshot before the
  // handler saw it. Env is the documented second rung of the same resolution
  // order, so this exercises the getter exactly as an install with no settings
  // database configured does.
  process.env.SHIP_FROM_NAME = "A.A Atelier";
  process.env.SHIP_FROM_STREET1 = "1200 Rink Road";
  process.env.SHIP_FROM_CITY = "Austin";
  process.env.SHIP_FROM_STATE = "TX";
  process.env.SHIP_FROM_ZIP = "78701";

  acceptToken("good-token", GOOGLE_STAFF);
  mockFind.mockResolvedValue({
    pageId: "page_1",
    orderNumber: "SHP-ABC-0001",
    email: "skater@example.com",
    sessionId: "cs_test_1",
    cancelled: false,
    deliveryMethod: "",
    trackingNumber: "",
    carrier: "",
  });
  mockRates.mockResolvedValue({ rates: [RATE], messages: [] });
  mockRecord.mockResolvedValue(true);
  mockStripe.mockReturnValue({
    checkout: {
      sessions: {
        retrieve: vi.fn(async () => ({
          id: "cs_test_1",
          collected_information: {
            shipping_details: {
              name: "A Skater",
              address: {
                line1: "9 Blade Way",
                city: "Denver",
                state: "CO",
                postal_code: "80202",
                country: "US",
              },
            },
          },
          customer_details: { email: "skater@example.com" },
        })),
      },
    },
  } as unknown as Stripe);
});

afterEach(() => {
  __resetSupabaseClient();
  __resetSettings();
  delete process.env.STUDIO_STAFF_EMAILS;
  delete process.env.STUDIO_REQUIRE_GOOGLE;
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const RATES_BODY = {
  orderNumber: "SHP-ABC-0001",
  parcelId: "box-small",
  weightOz: 14,
};

describe("the shipping routes are staff-gated like the rest of the dashboard", () => {
  it("401s an anonymous options read", async () => {
    const res = await request(app).get("/api/studio/shipments/options");
    expect(res.status).toBe(401);
  });

  it("404s a signed-in customer, exactly as a mistyped URL would", async () => {
    acceptToken("customer-token", {
      email: "skater@example.com",
      sub: "user-2",
      amr: ["oauth"],
    });
    const res = await request(app)
      .get("/api/studio/shipments/options")
      .set("Authorization", "Bearer customer-token");
    expect(res.status).toBe(404);
  });

  it("401s an anonymous purchase — the one that spends money", async () => {
    const res = await request(app)
      .post("/api/studio/shipments/label")
      .send({ orderNumber: "SHP-ABC-0001", rateId: "rate_1" });
    expect(res.status).toBe(401);
    expect(mockBuy).not.toHaveBeenCalled();
  });
});

describe("GET /api/studio/shipments/options", () => {
  it("serves the packaging catalog and the studio's origin", async () => {
    const res = await request(app)
      .get("/api/studio/shipments/options")
      .set("Authorization", "Bearer good-token");

    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(true);
    expect(res.body.problems).toEqual([]);
    expect(res.body.shipFrom).toContain("1200 Rink Road");
    expect(res.body.parcels.length).toBeGreaterThan(0);
  });

  it("says test mode out loud, because a test label looks entirely real", async () => {
    const res = await request(app)
      .get("/api/studio/shipments/options")
      .set("Authorization", "Bearer good-token");
    expect(res.body.testMode).toBe(true);
  });

  it("reports an unconfigured vendor as a problem, not an error", async () => {
    delete process.env.SHIPPO_API_KEY;
    const res = await request(app)
      .get("/api/studio/shipments/options")
      .set("Authorization", "Bearer good-token");

    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(false);
    expect(res.body.problems.join(" ")).toContain("SHIPPO_API_KEY");
  });
});

describe("POST /api/studio/shipments/rates", () => {
  it("quotes the parcel and shows the address it would post to", async () => {
    const res = await request(app)
      .post("/api/studio/shipments/rates")
      .set("Authorization", "Bearer good-token")
      .send(RATES_BODY);

    expect(res.status).toBe(200);
    expect(res.body.rates).toHaveLength(1);
    expect(res.body.shipTo).toContain("9 Blade Way");
    expect(mockBuy).not.toHaveBeenCalled();
  });

  it("400s a weight the generated schema won't accept", async () => {
    // The contract's own `exclusiveMinimum` catches this before the service —
    // a 0 oz parcel would otherwise be rated as a document envelope.
    const res = await request(app)
      .post("/api/studio/shipments/rates")
      .set("Authorization", "Bearer good-token")
      .send({ ...RATES_BODY, weightOz: 0 });

    expect(res.status).toBe(400);
    expect(mockRates).not.toHaveBeenCalled();
  });

  it("404s an order that doesn't exist", async () => {
    mockFind.mockResolvedValue(null);
    const res = await request(app)
      .post("/api/studio/shipments/rates")
      .set("Authorization", "Bearer good-token")
      .send(RATES_BODY);
    expect(res.status).toBe(404);
  });

  it("409s an order being collected in person", async () => {
    mockFind.mockResolvedValue({
      pageId: "page_1",
      orderNumber: "SHP-ABC-0001",
      email: "skater@example.com",
      sessionId: "cs_test_1",
      cancelled: false,
      deliveryMethod: "Local pickup",
      trackingNumber: "",
      carrier: "",
    });
    const res = await request(app)
      .post("/api/studio/shipments/rates")
      .set("Authorization", "Bearer good-token")
      .send(RATES_BODY);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/collected in person/);
  });
});

describe("POST /api/studio/shipments/label", () => {
  beforeEach(() => {
    mockBuy.mockResolvedValue({
      transactionId: "txn_1",
      trackingNumber: "9400100000000000000000",
      trackingUrl: "https://tools.usps.com/go/x",
      labelUrl: "https://example.test/label.pdf",
      carrier: "USPS",
      service: "Ground Advantage",
      amount: 7.45,
      currency: "USD",
    });
  });

  it("buys the label and fills in the order's tracking", async () => {
    const res = await request(app)
      .post("/api/studio/shipments/label")
      .set("Authorization", "Bearer good-token")
      .send({ orderNumber: "SHP-ABC-0001", rateId: "rate_1" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      trackingNumber: "9400100000000000000000",
      labelUrl: "https://example.test/label.pdf",
      recorded: true,
    });
    expect(mockRecord).toHaveBeenCalled();
  });

  it("409s an order that already has a label, without buying one", async () => {
    mockFind.mockResolvedValue({
      pageId: "page_1",
      orderNumber: "SHP-ABC-0001",
      email: "skater@example.com",
      sessionId: "cs_test_1",
      cancelled: false,
      deliveryMethod: "",
      trackingNumber: "TRACK1",
      carrier: "USPS",
    });
    const res = await request(app)
      .post("/api/studio/shipments/label")
      .set("Authorization", "Bearer good-token")
      .send({ orderNumber: "SHP-ABC-0001", rateId: "rate_1" });

    expect(res.status).toBe(409);
    expect(mockBuy).not.toHaveBeenCalled();
  });

  it("still returns the label when the order refused the write", async () => {
    // 200, not 500: the money is spent and the label is real. Throwing would
    // discard the only copy of a tracking number the studio has paid for.
    mockRecord.mockResolvedValue(false);
    const res = await request(app)
      .post("/api/studio/shipments/label")
      .set("Authorization", "Bearer good-token")
      .send({ orderNumber: "SHP-ABC-0001", rateId: "rate_1" });

    expect(res.status).toBe(200);
    expect(res.body.recorded).toBe(false);
    expect(res.body.trackingNumber).toBe("9400100000000000000000");
  });
});
