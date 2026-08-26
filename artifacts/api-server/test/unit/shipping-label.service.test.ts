import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The order lookup, the tracking writer, the vendor and Stripe are all mocked;
// what's under test is the decision layer between them — which orders may be
// posted, and what happens when the label is bought but the order won't take it.
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

import type Stripe from "stripe";
import {
  buyShippingLabel,
  getShippingOptions,
  getShippingRates,
  shipToFromSession,
} from "../../src/services/shipping-label.service.js";
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
  __setSettingsSnapshot,
  __resetSettings,
} from "../../src/lib/settings/store.js";
import { SHIP_FROM_KEYS } from "../../src/lib/shipping/from-address.js";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from "../../src/lib/errors.js";

const mockFind = vi.mocked(findShopOrderForShipping);
const mockRecord = vi.mocked(recordShopOrderTracking);
const mockRates = vi.mocked(fetchShippingRates);
const mockBuy = vi.mocked(purchaseLabel);
const mockStripe = vi.mocked(getStripeClient);

const SHIP_FROM = {
  SHIP_FROM_NAME: "A.A Atelier",
  SHIP_FROM_STREET1: "1200 Rink Road",
  SHIP_FROM_CITY: "Austin",
  SHIP_FROM_STATE: "TX",
  SHIP_FROM_ZIP: "78701",
};

const savedEnv = new Map<string, string | undefined>();

/** An order that can be posted, unless a test says otherwise. */
function order(over: Record<string, unknown> = {}) {
  return {
    pageId: "page_1",
    orderNumber: "SHP-ABC-0001",
    email: "skater@example.com",
    sessionId: "cs_test_1",
    cancelled: false,
    deliveryMethod: "",
    trackingNumber: "",
    carrier: "",
    ...over,
  };
}

/** A Stripe checkout carrying a complete shipping address. */
function session(over: Record<string, unknown> = {}) {
  return {
    id: "cs_test_1",
    collected_information: {
      shipping_details: {
        name: "A Skater",
        phone: "303-555-0100",
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
    ...over,
  } as unknown as Stripe.Checkout.Session;
}

function stripeReturning(value: unknown) {
  const retrieve = vi.fn(async () => value);
  mockStripe.mockReturnValue({
    checkout: { sessions: { retrieve } },
  } as unknown as Stripe);
  return retrieve;
}

const RATE = {
  id: "rate_1",
  carrier: "USPS",
  service: "Ground Advantage",
  amount: 7.45,
  currency: "USD",
};

beforeEach(() => {
  __resetSettings();
  for (const key of [...SHIP_FROM_KEYS, "SHIPPO_API_KEY"]) {
    savedEnv.set(key, process.env[key]);
    delete process.env[key];
  }
  process.env.SHIPPO_API_KEY = "shippo_test_abc123";
  __setSettingsSnapshot(SHIP_FROM);

  mockFind.mockResolvedValue(order());
  mockRates.mockResolvedValue({ rates: [RATE], messages: [] });
  mockRecord.mockResolvedValue(true);
  stripeReturning(session());
});

afterEach(() => {
  __resetSettings();
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const rateRequest = {
  orderNumber: "SHP-ABC-0001",
  parcelId: "box-small",
  weightOz: 14,
};

describe("getShippingOptions", () => {
  it("reports readiness rather than throwing, since only a human can clear it", () => {
    delete process.env.SHIPPO_API_KEY;
    const options = getShippingOptions();
    expect(options.configured).toBe(false);
    expect(options.problems.join(" ")).toContain("SHIPPO_API_KEY");
    // The packaging catalog is still served: the panel renders, and says why it
    // can't be used, rather than erroring on load.
    expect(options.parcels.length).toBeGreaterThan(0);
  });

  it("names an incomplete ship-from address as the studio's own to fix", () => {
    __setSettingsSnapshot({ SHIP_FROM_NAME: "A.A Atelier" });
    const options = getShippingOptions();
    expect(options.problems.join(" ")).toContain("Studio settings");
    expect(options.shipFrom).toBeUndefined();
  });

  it("is ready, and says where it posts from, once both halves are set", () => {
    const options = getShippingOptions();
    expect(options.problems).toEqual([]);
    expect(options.shipFrom).toContain("1200 Rink Road");
  });

  it("reports test mode from the token's own prefix", () => {
    expect(getShippingOptions().testMode).toBe(true);
    process.env.SHIPPO_API_KEY = "shippo_live_xyz";
    expect(getShippingOptions().testMode).toBe(false);
  });
});

describe("shipToFromSession", () => {
  it("reads the address in its PARTS, never from a display line", () => {
    const address = shipToFromSession(session());
    expect(address).toMatchObject({
      name: "A Skater",
      street1: "9 Blade Way",
      city: "Denver",
      state: "CO",
      zip: "80202",
      country: "US",
    });
  });

  it("reads the older Stripe shape too", () => {
    const address = shipToFromSession(
      session({
        collected_information: undefined,
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
      }),
    );
    expect(address.street1).toBe("9 Blade Way");
  });

  it("falls back to the billing address only when no shipping was collected", () => {
    const address = shipToFromSession(
      session({
        collected_information: undefined,
        customer_details: {
          name: "A Skater",
          email: "skater@example.com",
          address: {
            line1: "1 Billing St",
            city: "Denver",
            state: "CO",
            postal_code: "80202",
            country: "US",
          },
        },
      }),
    );
    expect(address.street1).toBe("1 Billing St");
  });
});

describe("getShippingRates", () => {
  it("quotes the chosen parcel against the studio's origin", async () => {
    const result = await getShippingRates(rateRequest);

    expect(result.rates).toEqual([RATE]);
    expect(result.shipTo).toContain("9 Blade Way");
    const [from, to, parcel] = mockRates.mock.calls[0];
    expect(from.zip).toBe("78701");
    expect(to.zip).toBe("80202");
    expect(parcel).toMatchObject({
      length: 12,
      width: 9,
      height: 4,
      weightOz: 14,
    });
  });

  it("buys nothing", async () => {
    await getShippingRates(rateRequest);
    expect(mockBuy).not.toHaveBeenCalled();
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("refuses a packaging size that isn't the studio's", async () => {
    await expect(
      getShippingRates({ ...rateRequest, parcelId: "crate" }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("refuses an implausible weight before it reaches the carrier", async () => {
    await expect(
      getShippingRates({ ...rateRequest, weightOz: 0 }),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(mockRates).not.toHaveBeenCalled();
  });

  it("refuses a custom order's number, which has no cart behind it", async () => {
    await expect(
      getShippingRates({ ...rateRequest, orderNumber: "ORD-000002" }),
    ).rejects.toThrow(/SHP-/);
  });

  it("404s an order that doesn't exist", async () => {
    mockFind.mockResolvedValue(null);
    await expect(getShippingRates(rateRequest)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("refuses a cancelled order", async () => {
    mockFind.mockResolvedValue(order({ cancelled: true }));
    await expect(getShippingRates(rateRequest)).rejects.toThrow(/cancelled/);
  });

  it("refuses an order the customer is collecting in person", async () => {
    // A pickup order needs no label, and the words are matched through the same
    // `looksLikePickup` the tracking page reads the column with.
    mockFind.mockResolvedValue(order({ deliveryMethod: "Local pickup" }));
    await expect(getShippingRates(rateRequest)).rejects.toThrow(
      /collected in person/,
    );
  });

  it("refuses an order that wasn't paid through the website", async () => {
    // A hand-filed Etsy or skate-shop row has no Stripe session, so there is no
    // address in its parts — and guessing one is the whole thing this avoids.
    mockFind.mockResolvedValue(order({ sessionId: "" }));
    await expect(getShippingRates(rateRequest)).rejects.toThrow(
      /wasn't paid through the website/,
    );
  });

  it("refuses when the checkout's address is incomplete", async () => {
    stripeReturning(
      session({
        collected_information: {
          shipping_details: { name: "A Skater", address: { city: "Denver" } },
        },
      }),
    );
    await expect(getShippingRates(rateRequest)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("refuses when no vendor is connected", async () => {
    delete process.env.SHIPPO_API_KEY;
    await expect(getShippingRates(rateRequest)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("refuses when the studio's own address is incomplete", async () => {
    __setSettingsSnapshot({ SHIP_FROM_NAME: "A.A Atelier" });
    await expect(getShippingRates(rateRequest)).rejects.toThrow(
      /Studio settings/,
    );
  });

  it("still quotes an order that already has tracking on it", async () => {
    // Asking what a second label would cost is reasonable; the refusal belongs
    // where money moves, not where a question is asked.
    mockFind.mockResolvedValue(order({ trackingNumber: "TRACK1" }));
    await expect(getShippingRates(rateRequest)).resolves.toMatchObject({
      rates: [RATE],
    });
  });
});

describe("buyShippingLabel", () => {
  const bought = {
    transactionId: "txn_1",
    trackingNumber: "9400100000000000000000",
    trackingUrl: "https://tools.usps.com/go/x",
    labelUrl: "https://example.test/label.pdf",
    carrier: "USPS",
    service: "Ground Advantage",
    amount: 7.45,
    currency: "USD",
  };

  beforeEach(() => {
    mockBuy.mockResolvedValue(bought);
  });

  it("buys the rate and writes its tracking onto the order", async () => {
    const result = await buyShippingLabel({
      orderNumber: "SHP-ABC-0001",
      rateId: "rate_1",
    });

    expect(mockBuy).toHaveBeenCalledWith("rate_1");
    expect(mockRecord).toHaveBeenCalledWith("page_1", {
      number: "9400100000000000000000",
      carrier: "USPS",
      url: "https://tools.usps.com/go/x",
    });
    expect(result).toMatchObject({
      orderNumber: "SHP-ABC-0001",
      trackingNumber: "9400100000000000000000",
      recorded: true,
      testMode: true,
    });
  });

  it("refuses an order that already carries a label", async () => {
    // The vendor will sell a duplicate as happily as the first and has nothing
    // to read back that says otherwise, so the ORDER is the guard.
    mockFind.mockResolvedValue(
      order({ trackingNumber: "TRACK1", carrier: "USPS" }),
    );
    await expect(
      buyShippingLabel({ orderNumber: "SHP-ABC-0001", rateId: "rate_1" }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(mockBuy).not.toHaveBeenCalled();
  });

  it("buys a replacement when the atelier explicitly asks for one", async () => {
    mockFind.mockResolvedValue(order({ trackingNumber: "TRACK1" }));
    await expect(
      buyShippingLabel({
        orderNumber: "SHP-ABC-0001",
        rateId: "rate_1",
        replace: true,
      }),
    ).resolves.toMatchObject({ recorded: true });
    expect(mockBuy).toHaveBeenCalled();
  });

  it("reports a failed write instead of losing the label it paid for", async () => {
    // The purchase outranks its bookkeeping: throwing here would discard a
    // tracking number the studio has already been charged for.
    mockRecord.mockResolvedValue(false);
    const result = await buyShippingLabel({
      orderNumber: "SHP-ABC-0001",
      rateId: "rate_1",
    });
    expect(result.recorded).toBe(false);
    expect(result.trackingNumber).toBe("9400100000000000000000");
    expect(result.labelUrl).toBe("https://example.test/label.pdf");
  });

  it("re-checks the order rather than trusting the rate step", async () => {
    // The two calls are separated by however long the atelier spent reading the
    // list, and an order cancelled in between must not be posted.
    mockFind.mockResolvedValue(order({ cancelled: true }));
    await expect(
      buyShippingLabel({ orderNumber: "SHP-ABC-0001", rateId: "rate_1" }),
    ).rejects.toThrow(/cancelled/);
    expect(mockBuy).not.toHaveBeenCalled();
  });

  it("refuses with no rate chosen", async () => {
    await expect(
      buyShippingLabel({ orderNumber: "SHP-ABC-0001", rateId: "  " }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("does not write a blank carrier or URL onto the order", async () => {
    mockBuy.mockResolvedValue({
      ...bought,
      carrier: "",
      trackingUrl: undefined,
    });
    await buyShippingLabel({ orderNumber: "SHP-ABC-0001", rateId: "rate_1" });
    expect(mockRecord).toHaveBeenCalledWith("page_1", {
      number: "9400100000000000000000",
    });
  });
});
