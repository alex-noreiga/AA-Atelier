import { describe, it, expect, vi } from "vitest";

// Mock both repositories so the HTTP stack (routing → validation → service
// gates → response schema parse → error handler) runs end-to-end without the
// network. The service's gate logic runs for real.
vi.mock("../../src/lib/notion/shop-orders.repository.js", () => ({
  findShopOrderVerification: vi.fn(),
}));
vi.mock("../../src/lib/notion/return-request.repository.js", () => ({
  createReturnRequest: vi.fn(),
}));

import request from "supertest";
import { returnRequestInput } from "@workspace/test-fixtures";
import app from "../../src/app.js";
import { findShopOrderVerification } from "../../src/lib/notion/shop-orders.repository.js";
import { createReturnRequest } from "../../src/lib/notion/return-request.repository.js";
import { shopOrderVerification } from "../support/shop-order-verification.js";

const mockFind = vi.mocked(findShopOrderVerification);
const mockWrite = vi.mocked(createReturnRequest);

const url = "/api/shop-orders/SHP-ABC-1234/return-requests";
const validBody = returnRequestInput({ email: "grace@example.com" });

describe("POST /api/shop-orders/:orderNumber/return-requests", () => {
  it("returns 201 when the email matches the order", async () => {
    mockFind.mockResolvedValue(
      shopOrderVerification({
        pageId: "page-shop-test",
        email: "grace@example.com",
      }),
    );
    mockWrite.mockResolvedValue();

    const res = await request(app).post(url).send(validBody);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ received: true });
    expect(mockWrite).toHaveBeenCalledOnce();
  });

  it("returns 201 for an exchange with exchangeFor + items", async () => {
    mockFind.mockResolvedValue(
      shopOrderVerification({
        pageId: "page-shop-test",
        email: "grace@example.com",
      }),
    );
    mockWrite.mockResolvedValue();

    const res = await request(app)
      .post(url)
      .send(
        returnRequestInput({
          email: "grace@example.com",
          kind: "exchange",
          reason: "wrong_size",
          items: "Skate Soaker — Pink",
          exchangeFor: "size L",
        }),
      );

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ received: true });
  });

  it("returns 404 when the order does not exist", async () => {
    mockFind.mockResolvedValue(null);

    const res = await request(app).post(url).send(validBody);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("message");
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("returns 403 when the email doesn't match the order", async () => {
    mockFind.mockResolvedValue(
      shopOrderVerification({
        pageId: "page-shop-test",
        email: "someone-else@example.com",
      }),
    );

    const res = await request(app).post(url).send(validBody);

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty("error");
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("returns 400 and never looks up the order for an invalid body", async () => {
    const res = await request(app)
      .post(url)
      .send({ email: "not-an-email", kind: "return", reason: "wrong_size" });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(mockFind).not.toHaveBeenCalled();
  });

  it("returns 400 for an unknown kind/reason enum value", async () => {
    const res = await request(app)
      .post(url)
      .send({ email: "grace@example.com", kind: "refund", reason: "nope" });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(mockWrite).not.toHaveBeenCalled();
  });
});
