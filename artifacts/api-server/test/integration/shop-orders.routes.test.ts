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
