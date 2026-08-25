import { describe, it, expect, vi } from "vitest";

// Mock the order lookup + reviews writer so the HTTP stack (routing →
// validation → service gates → response schema parse → error handler) runs
// end-to-end without the network. The service's gate logic runs for real.
vi.mock("../../src/lib/notion/orders.repository.js", () => ({
  findOrderVerification: vi.fn(),
}));
vi.mock("../../src/lib/notion/reviews.repository.js", () => ({
  createReview: vi.fn(),
  listPublishedReviews: vi.fn(),
}));

import request from "supertest";
import { reviewInput } from "@workspace/test-fixtures";
import app from "../../src/app.js";
import { findOrderVerification } from "../../src/lib/notion/orders.repository.js";
import { createReview } from "../../src/lib/notion/reviews.repository.js";

const mockFind = vi.mocked(findOrderVerification);
const mockWrite = vi.mocked(createReview);

const STAGES = ["Consultation", "Sketching", "Cutting/Pinning", "Delivery"];
const url = "/api/orders/000002/reviews";
const validBody = reviewInput({ email: "ada@example.com" });

describe("POST /api/orders/:orderNumber/reviews", () => {
  it("returns 201 when the email matches and the order is delivered", async () => {
    mockFind.mockResolvedValue({
      email: "ada@example.com",
      pageId: "page-order-test",
      orderName: "Ada – Custom Dress",
      currentStage: "Delivery",
      stages: STAGES,
    });
    mockWrite.mockResolvedValue();

    const res = await request(app).post(url).send(validBody);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ received: true });
    expect(mockWrite).toHaveBeenCalledOnce();
  });

  it("returns 404 when the order does not exist", async () => {
    mockFind.mockResolvedValue(null);

    const res = await request(app).post(url).send(validBody);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("message");
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("returns 409 when the order hasn't been delivered yet", async () => {
    mockFind.mockResolvedValue({
      email: "ada@example.com",
      pageId: "page-order-test",
      orderName: "Ada – Custom Dress",
      currentStage: "Sketching",
      stages: STAGES,
    });

    const res = await request(app).post(url).send(validBody);

    expect(res.status).toBe(409);
    expect(res.body).toHaveProperty("error");
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("returns 403 when the email doesn't match the order", async () => {
    mockFind.mockResolvedValue({
      email: "someone-else@example.com",
      pageId: "page-order-test",
      orderName: "Ada – Custom Dress",
      currentStage: "Delivery",
      stages: STAGES,
    });

    const res = await request(app).post(url).send(validBody);

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty("error");
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("returns 400 and never looks up the order for an invalid body", async () => {
    const res = await request(app)
      .post(url)
      .send({ ...validBody, rating: 9, comment: "" });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(mockFind).not.toHaveBeenCalled();
  });

  it("returns 400 when required fields are missing", async () => {
    const res = await request(app).post(url).send({ email: "ada@example.com" });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(mockWrite).not.toHaveBeenCalled();
  });
});
