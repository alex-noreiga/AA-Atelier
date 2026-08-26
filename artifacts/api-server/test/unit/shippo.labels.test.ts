import { describe, it, expect, vi } from "vitest";

import {
  fetchShippingRates,
  purchaseLabel,
} from "../../src/lib/shippo/labels.repository.js";
import type { ShippoClient } from "../../src/lib/shippo/client.js";
import { toPostalAddress } from "../../src/lib/shipping/address.js";
import {
  BadRequestError,
  ServiceUnavailableError,
} from "../../src/lib/errors.js";

const FROM = toPostalAddress({
  name: "A.A Atelier",
  street1: "1200 Rink Road",
  city: "Austin",
  state: "TX",
  zip: "78701",
  country: "US",
});
const TO = toPostalAddress({
  name: "A Skater",
  street1: "9 Blade Way",
  city: "Denver",
  state: "CO",
  zip: "80202",
  country: "US",
});
const PARCEL = { length: 12, width: 9, height: 4, weightOz: 14 };

/** A client that answers one canned response and records what it was sent. */
function fakeClient(
  status: number,
  body: unknown,
): { client: ShippoClient; calls: Array<{ path: string; body: unknown }> } {
  const calls: Array<{ path: string; body: unknown }> = [];
  const client: ShippoClient = {
    fetch: vi.fn(async (path: string, init?: RequestInit) => {
      calls.push({
        path,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    }),
  };
  return { client, calls };
}

const RATE = (over: Record<string, unknown> = {}) => ({
  object_id: "rate_1",
  amount: "7.45",
  currency: "USD",
  provider: "USPS",
  estimated_days: 3,
  duration_terms: "Delivered in 2 to 5 days",
  servicelevel: { name: "Ground Advantage", token: "usps_ground_advantage" },
  ...over,
});

describe("fetchShippingRates", () => {
  it("sends the parcel in inches and ounces, synchronously", async () => {
    const { client, calls } = fakeClient(201, { rates: [RATE()] });
    await fetchShippingRates(FROM, TO, PARCEL, client);

    const sent = calls[0].body as Record<string, any>;
    expect(calls[0].path).toBe("/shipments/");
    expect(sent.parcels[0]).toMatchObject({
      length: "12",
      width: "9",
      height: "4",
      distance_unit: "in",
      weight: "14",
      mass_unit: "oz",
    });
    // Synchronous, so the request that asked can answer: the queued form would
    // need somewhere to keep a shipment id between two HTTP calls.
    expect(sent.async).toBe(false);
    expect(sent.address_from.zip).toBe("78701");
    expect(sent.address_to.zip).toBe("80202");
  });

  it("returns rates cheapest first, which is the order they're chosen in", async () => {
    const { client } = fakeClient(201, {
      rates: [
        RATE({ object_id: "b", amount: "19.20", provider: "UPS" }),
        RATE({ object_id: "a", amount: "7.45" }),
        RATE({ object_id: "c", amount: "12.00", provider: "FedEx" }),
      ],
    });
    const { rates } = await fetchShippingRates(FROM, TO, PARCEL, client);
    expect(rates.map((rate) => rate.id)).toEqual(["a", "c", "b"]);
  });

  it("parses the money out of the decimal string the vendor sends", async () => {
    const { client } = fakeClient(201, { rates: [RATE()] });
    const { rates } = await fetchShippingRates(FROM, TO, PARCEL, client);
    expect(rates[0].amount).toBe(7.45);
    expect(rates[0].currency).toBe("USD");
    expect(rates[0].carrier).toBe("USPS");
    expect(rates[0].service).toBe("Ground Advantage");
    expect(rates[0].estimatedDays).toBe(3);
  });

  it("drops a rate that couldn't be bought anyway", async () => {
    // No object_id ⇒ unbuyable; no provider ⇒ unreadable. Showing either would
    // only offer the atelier a dead choice.
    const { client } = fakeClient(201, {
      rates: [
        RATE({ object_id: undefined }),
        RATE({ object_id: "x", provider: undefined }),
        RATE({ object_id: "ok" }),
      ],
    });
    const { rates } = await fetchShippingRates(FROM, TO, PARCEL, client);
    expect(rates.map((rate) => rate.id)).toEqual(["ok"]);
  });

  it("treats no rates as an answer, not an error, and carries the reason back", async () => {
    const { client } = fakeClient(201, {
      rates: [],
      messages: [
        { text: "Your USPS account isn't connected." },
        { text: "  " },
      ],
    });
    const { rates, messages } = await fetchShippingRates(
      FROM,
      TO,
      PARCEL,
      client,
    );
    expect(rates).toEqual([]);
    expect(messages).toEqual(["Your USPS account isn't connected."]);
  });

  it("surfaces a 4xx as a request problem the atelier can act on", async () => {
    const { client } = fakeClient(400, { detail: "zip is invalid" });
    await expect(
      fetchShippingRates(FROM, TO, PARCEL, client),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("surfaces a 5xx as a retriable outage rather than the studio's fault", async () => {
    const { client } = fakeClient(503, {});
    await expect(
      fetchShippingRates(FROM, TO, PARCEL, client),
    ).rejects.toBeInstanceOf(ServiceUnavailableError);
  });
});

describe("purchaseLabel", () => {
  it("buys the rate and returns what was bought", async () => {
    const { client, calls } = fakeClient(201, {
      object_id: "txn_1",
      status: "SUCCESS",
      tracking_number: "9400100000000000000000",
      tracking_url_provider: "https://tools.usps.com/go/x",
      label_url: "https://shippo-delivery.s3.amazonaws.com/label.pdf",
      rate: RATE(),
    });

    const label = await purchaseLabel("rate_1", client);

    expect(calls[0].path).toBe("/transactions/");
    expect(calls[0].body).toMatchObject({
      rate: "rate_1",
      label_file_type: "PDF_4x6",
      async: false,
    });
    expect(label).toMatchObject({
      transactionId: "txn_1",
      trackingNumber: "9400100000000000000000",
      trackingUrl: "https://tools.usps.com/go/x",
      carrier: "USPS",
      service: "Ground Advantage",
      amount: 7.45,
    });
  });

  it("throws on a FAILED transaction that came back 201", async () => {
    // The failure mode that matters most: reading only the status code would
    // report a label bought, write a blank tracking number onto the order, and
    // send the atelier to print nothing.
    const { client } = fakeClient(201, {
      object_id: "txn_2",
      status: "ERROR",
      messages: [{ text: "The rate has expired." }],
    });

    await expect(purchaseLabel("rate_1", client)).rejects.toThrow(
      /The rate has expired\./,
    );
  });

  it("throws on a SUCCESS with no tracking number", async () => {
    // A label nobody can track is not a label — and it is the exact shape that
    // would otherwise write an empty string over the order's tracking column.
    const { client } = fakeClient(201, {
      object_id: "txn_3",
      status: "SUCCESS",
      tracking_number: "  ",
      rate: RATE(),
    });
    await expect(purchaseLabel("rate_1", client)).rejects.toBeInstanceOf(
      BadRequestError,
    );
  });

  it("says the rate may have expired when the vendor gives no reason", async () => {
    const { client } = fakeClient(201, { object_id: "txn_4", status: "ERROR" });
    await expect(purchaseLabel("rate_1", client)).rejects.toThrow(
      /rate may have expired/,
    );
  });

  it("copes with an unexpanded rate rather than losing the label", async () => {
    const { client } = fakeClient(201, {
      object_id: "txn_5",
      status: "SUCCESS",
      tracking_number: "TRACK1",
      rate: "rate_1",
    });
    const label = await purchaseLabel("rate_1", client);
    expect(label.trackingNumber).toBe("TRACK1");
    expect(label.carrier).toBe("");
  });
});
