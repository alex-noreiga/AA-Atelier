import { describe, it, expect, vi } from "vitest";

// Mock the repositories so the HTTP stack (routing → validation → service gates
// → response schema parse → error handler) runs end-to-end without the network.
// The service's identity gate runs for real.
vi.mock("../../src/lib/notion/orders.repository.js", () => ({
  findOrderForMeasurementChange: vi.fn(),
}));
vi.mock("../../src/lib/notion/reviews.repository.js", () => ({
  createReview: vi.fn(),
  listPublishedReviews: vi.fn(),
}));

import request from "supertest";
import { reviewInput, reviewRecord } from "@workspace/test-fixtures";
import app from "../../src/app.js";
import { findOrderForMeasurementChange } from "../../src/lib/notion/orders.repository.js";
import {
  createReview,
  listPublishedReviews,
} from "../../src/lib/notion/reviews.repository.js";

const mockFind = vi.mocked(findOrderForMeasurementChange);
const mockWrite = vi.mocked(createReview);
const mockList = vi.mocked(listPublishedReviews);

const STAGES = ["Consultation", "Delivery"];
const matchingOrder = {
  email: "ada@example.com",
  currentStage: "Consultation",
  stages: STAGES,
};

describe("GET /api/reviews", () => {
  it("returns the published reviews", async () => {
    mockList.mockResolvedValue([reviewRecord({ id: "r1" })]);

    const res = await request(app).get("/api/reviews");

    expect(res.status).toBe(200);
    expect(res.body.reviews).toHaveLength(1);
    expect(res.body.reviews[0].id).toBe("r1");
  });

  it("sets an edge cache-control header", async () => {
    mockList.mockResolvedValue([]);
    const res = await request(app).get("/api/reviews");
    expect(res.headers["cache-control"]).toContain("s-maxage=120");
  });
});

describe("POST /api/reviews", () => {
  const validBody = reviewInput({ orderNumber: "000002" });

  it("returns 201 when the email matches the order", async () => {
    mockFind.mockResolvedValue(matchingOrder);
    mockWrite.mockResolvedValue();

    const res = await request(app).post("/api/reviews").send(validBody);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true });
    expect(mockWrite).toHaveBeenCalledOnce();
  });

  it("returns 404 when the order does not exist", async () => {
    mockFind.mockResolvedValue(null);

    const res = await request(app).post("/api/reviews").send(validBody);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("message");
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("returns 403 when the email doesn't match the order", async () => {
    mockFind.mockResolvedValue({
      ...matchingOrder,
      email: "someone-else@example.com",
    });

    const res = await request(app).post("/api/reviews").send(validBody);

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty("error");
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("returns 400 and never looks up the order for an invalid body", async () => {
    const res = await request(app)
      .post("/api/reviews")
      .send({ ...validBody, email: "not-an-email", rating: 9 });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
    expect(mockFind).not.toHaveBeenCalled();
  });
});
