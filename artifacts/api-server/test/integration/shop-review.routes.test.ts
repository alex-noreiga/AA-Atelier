import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the repositories so the HTTP stack (routing → validation → service gates
// → response schema parse → error handler) runs end-to-end without the network.
// The service's gate logic runs for real — the point of this file is which
// status code each refusal reaches the customer as.
vi.mock("../../src/lib/notion/shop-orders.repository.js", () => ({
  findShopOrderVerification: vi.fn(),
  fetchLiveShopOrderStatuses: vi.fn(),
}));
vi.mock("../../src/lib/notion/reviews.repository.js", () => ({
  createReview: vi.fn(),
}));
vi.mock("../../src/services/products.service.js", () => ({
  findVariantNames: vi.fn(),
}));

import request from "supertest";
import { shopReviewInput } from "@workspace/test-fixtures";
import app from "../../src/app.js";
import {
  findShopOrderVerification,
  fetchLiveShopOrderStatuses,
} from "../../src/lib/notion/shop-orders.repository.js";
import { createReview } from "../../src/lib/notion/reviews.repository.js";
import { findVariantNames } from "../../src/services/products.service.js";
import { shopOrderVerification } from "../support/shop-order-verification.js";

const mockFind = vi.mocked(findShopOrderVerification);
const mockStatuses = vi.mocked(fetchLiveShopOrderStatuses);
const mockWrite = vi.mocked(createReview);
const mockNames = vi.mocked(findVariantNames);

const url = "/api/shop-orders/SHP-ABC-1234/reviews";
const validBody = shopReviewInput({ email: "grace@example.com" });

beforeEach(() => {
  mockStatuses.mockResolvedValue(["Paid", "Shipped", "Delivered"]);
  mockNames.mockResolvedValue(new Map([["inv-aurora", "Aurora Soaker"]]));
  mockFind.mockResolvedValue(shopOrderVerification());
  mockWrite.mockResolvedValue();
});

describe("POST /api/shop-orders/:orderNumber/reviews", () => {
  it("returns 201 when the order is delivered and the email matches", async () => {
    const res = await request(app).post(url).send(validBody);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ received: true });
    expect(mockWrite).toHaveBeenCalledOnce();
  });

  it("returns 404 for an unknown order number", async () => {
    mockFind.mockResolvedValue(null);

    const res = await request(app).post(url).send(validBody);

    expect(res.status).toBe(404);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("returns 403 when the email doesn't match the order", async () => {
    mockFind.mockResolvedValue(
      shopOrderVerification({ email: "someone-else@example.com" }),
    );

    const res = await request(app).post(url).send(validBody);

    expect(res.status).toBe(403);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("returns 409 while the order is still on its way", async () => {
    mockFind.mockResolvedValue(shopOrderVerification({ status: "Shipped" }));

    const res = await request(app).post(url).send(validBody);

    expect(res.status).toBe(409);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("returns 409 for a cancelled order", async () => {
    mockFind.mockResolvedValue(shopOrderVerification({ cancelled: true }));

    const res = await request(app).post(url).send(validBody);

    expect(res.status).toBe(409);
  });

  it("returns 400 for a piece that isn't on the order", async () => {
    const res = await request(app)
      .post(url)
      .send(
        shopReviewInput({ email: "grace@example.com", productId: "inv-x" }),
      );

    expect(res.status).toBe(400);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  // The contract requires the piece, so this never reaches the service.
  it("returns 400 when the body names no piece at all", async () => {
    const { productId: _productId, ...withoutPiece } = validBody;

    const res = await request(app).post(url).send(withoutPiece);

    expect(res.status).toBe(400);
    expect(mockFind).not.toHaveBeenCalled();
  });

  it("returns 400 for a rating outside 1-5", async () => {
    const res = await request(app)
      .post(url)
      .send(shopReviewInput({ email: "grace@example.com", rating: 9 }));

    expect(res.status).toBe(400);
    expect(mockWrite).not.toHaveBeenCalled();
  });
});
