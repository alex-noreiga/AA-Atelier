import { describe, it, expect, vi } from "vitest";

// Mock the shop-orders repository so the HTTP stack (routing → validation →
// service → response parse → error handler) runs end-to-end without the network.
vi.mock("../../src/lib/notion/shop-orders.repository.js", () => ({
  findShopOrderByNumber: vi.fn(),
  fetchLiveShopOrderStatuses: vi.fn(),
}));

import request from "supertest";
import app from "../../src/app.js";
import {
  findShopOrderByNumber,
  fetchLiveShopOrderStatuses,
} from "../../src/lib/notion/shop-orders.repository.js";

const mockFind = vi.mocked(findShopOrderByNumber);
const mockStatuses = vi.mocked(fetchLiveShopOrderStatuses);

describe("GET /api/shop-orders/:orderNumber", () => {
  it("returns 200 with the order's status and the live timeline", async () => {
    mockFind.mockResolvedValue({
      orderNumber: "SHP-ABC-1234",
      status: "Processing",
      total: 44,
    });
    mockStatuses.mockResolvedValue([
      "Payment Confirmed",
      "Processing",
      "Shipped",
    ]);

    const res = await request(app).get("/api/shop-orders/SHP-ABC-1234");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      orderNumber: "SHP-ABC-1234",
      status: "Processing",
      statuses: ["Payment Confirmed", "Processing", "Shipped"],
      total: 44,
    });
  });

  it("passes carrier tracking through to the response when present", async () => {
    mockFind.mockResolvedValue({
      orderNumber: "SHP-1",
      status: "Shipped",
      fulfilmentFields: {
        trackingNumber: "9400111899",
        carrier: "USPS",
        trackingUrl:
          "https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111899",
      },
    });
    mockStatuses.mockResolvedValue([
      "Payment Confirmed",
      "Processing",
      "Shipped",
    ]);

    const res = await request(app).get("/api/shop-orders/SHP-1");

    expect(res.status).toBe(200);
    expect(res.body.fulfilment).toEqual({
      method: "ship",
      tracking: {
        number: "9400111899",
        carrier: "USPS",
        url: "https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111899",
      },
    });
  });

  it("reports a scheduled local pickup instead of tracking", async () => {
    mockFind.mockResolvedValue({
      orderNumber: "SHP-1",
      status: "Packed",
      fulfilmentFields: {
        method: "Local pickup",
        pickupAt: "2026-09-03T14:00:00.000-05:00",
        pickupLocation: "The studio — 12 Rink Road",
      },
    });
    mockStatuses.mockResolvedValue(["Payment Confirmed", "Packed", "Shipped"]);

    const res = await request(app).get("/api/shop-orders/SHP-1");

    expect(res.status).toBe(200);
    expect(res.body.fulfilment).toEqual({
      method: "pickup",
      pickup: {
        at: "2026-09-03T14:00:00.000-05:00",
        location: "The studio — 12 Rink Road",
        timezone: "America/Chicago",
      },
    });
    expect(res.body.fulfilment.tracking).toBeUndefined();
  });

  it("drops the fulfilment view entirely on a cancelled order", async () => {
    mockFind.mockResolvedValue({
      orderNumber: "SHP-1",
      status: "Cancelled",
      cancelled: true,
      fulfilmentFields: { trackingNumber: "9400111899" },
    });
    mockStatuses.mockResolvedValue(["Payment Confirmed", "Processing"]);

    const res = await request(app).get("/api/shop-orders/SHP-1");

    expect(res.status).toBe(200);
    expect(res.body.cancelled).toBe(true);
    expect(res.body.fulfilment).toBeUndefined();
  });

  it("appends an off-list current status to the timeline", async () => {
    mockFind.mockResolvedValue({
      orderNumber: "SHP-ABC-1234",
      status: "On Hold",
    });
    mockStatuses.mockResolvedValue(["Payment Confirmed", "Processing"]);

    const res = await request(app).get("/api/shop-orders/SHP-ABC-1234");

    expect(res.status).toBe(200);
    expect(res.body.statuses).toEqual([
      "Payment Confirmed",
      "Processing",
      "On Hold",
    ]);
  });

  it("returns 404 with a message when no order matches", async () => {
    mockFind.mockResolvedValue(null);
    mockStatuses.mockResolvedValue(["Payment Confirmed"]);

    const res = await request(app).get("/api/shop-orders/SHP-NOPE");

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("message");
  });
});
