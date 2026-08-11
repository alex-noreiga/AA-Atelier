import { describe, it, expect, vi } from "vitest";

// Mock the lookups + inbox writer so the HTTP stack (routing → validation →
// service gates → response parse → error handler) runs end-to-end without the
// network. The service's gate logic runs for real.
vi.mock("../../src/lib/notion/orders.repository.js", () => ({
  findOrderVerification: vi.fn(),
}));
vi.mock("../../src/lib/notion/shop-orders.repository.js", () => ({
  findShopOrderForCancellation: vi.fn(),
}));
vi.mock("../../src/lib/notion/cancellation.repository.js", () => ({
  createCancellationRequest: vi.fn(),
}));

import request from "supertest";
import { cancellationInput } from "@workspace/test-fixtures";
import app from "../../src/app.js";
import { findOrderVerification } from "../../src/lib/notion/orders.repository.js";
import { findShopOrderForCancellation } from "../../src/lib/notion/shop-orders.repository.js";
import { createCancellationRequest } from "../../src/lib/notion/cancellation.repository.js";

const mockFindOrder = vi.mocked(findOrderVerification);
const mockFindShop = vi.mocked(findShopOrderForCancellation);
const mockWrite = vi.mocked(createCancellationRequest);

const STAGES = ["Consultation", "Sketching", "Delivery"];
const customUrl = "/api/orders/ORD-1/cancellation-requests";
const shopUrl = "/api/shop-orders/SHP-1/cancellation-requests";
const validBody = cancellationInput({ email: "ada@example.com" });

describe("POST /api/orders/:orderNumber/cancellation-requests (custom)", () => {
  it("returns 201 when the email matches and the order isn't delivered", async () => {
    mockFindOrder.mockResolvedValue({
      email: "ada@example.com",
      pageId: "page-order-test",
      currentStage: "Sketching",
      stages: STAGES,
    });
    mockWrite.mockResolvedValue();

    const res = await request(app).post(customUrl).send(validBody);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ received: true });
    expect(mockWrite).toHaveBeenCalledOnce();
  });

  it("returns 404 when the order does not exist", async () => {
    mockFindOrder.mockResolvedValue(null);
    const res = await request(app).post(customUrl).send(validBody);
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("message");
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("returns 403 when the email doesn't match", async () => {
    mockFindOrder.mockResolvedValue({
      email: "someone-else@example.com",
      pageId: "page-order-test",
      currentStage: "Sketching",
      stages: STAGES,
    });
    const res = await request(app).post(customUrl).send(validBody);
    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty("error");
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("returns 409 when the order has already been delivered", async () => {
    mockFindOrder.mockResolvedValue({
      email: "ada@example.com",
      pageId: "page-order-test",
      currentStage: "Delivery",
      stages: STAGES,
    });
    const res = await request(app).post(customUrl).send(validBody);
    expect(res.status).toBe(409);
    expect(res.body).toHaveProperty("error");
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid body and never looks up the order", async () => {
    const res = await request(app)
      .post(customUrl)
      .send({ email: "not-an-email" });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(mockFindOrder).not.toHaveBeenCalled();
  });
});

describe("POST /api/shop-orders/:orderNumber/cancellation-requests (shop)", () => {
  it("returns 201 when the email matches (no delivery gate)", async () => {
    mockFindShop.mockResolvedValue({
      pageId: "shop-page",
      orderNumber: "SHP-1",
      email: "ada@example.com",
      sessionId: "cs_1",
      status: "Shipped",
      cancelled: false,
    });
    mockWrite.mockResolvedValue();

    const res = await request(app).post(shopUrl).send(validBody);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ received: true });
    expect(mockWrite).toHaveBeenCalledOnce();
  });

  it("returns 404 when the shop order does not exist", async () => {
    mockFindShop.mockResolvedValue(null);
    const res = await request(app).post(shopUrl).send(validBody);
    expect(res.status).toBe(404);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("returns 403 when the email doesn't match", async () => {
    mockFindShop.mockResolvedValue({
      pageId: "shop-page",
      orderNumber: "SHP-1",
      email: "someone-else@example.com",
      sessionId: "cs_1",
      status: "Payment Confirmed",
      cancelled: false,
    });
    const res = await request(app).post(shopUrl).send(validBody);
    expect(res.status).toBe(403);
    expect(mockWrite).not.toHaveBeenCalled();
  });
});
