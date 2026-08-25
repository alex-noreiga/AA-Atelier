import { describe, it, expect, vi } from "vitest";

// Mock only the Notion read; the HTTP stack (routing → query validation →
// service → response schema parse → error handler) runs for real.
vi.mock("../../src/lib/notion/reviews.repository.js", () => ({
  createReview: vi.fn(),
  listPublishedReviews: vi.fn(),
}));

import request from "supertest";
import app from "../../src/app.js";
import { listPublishedReviews } from "../../src/lib/notion/reviews.repository.js";

const mockList = vi.mocked(listPublishedReviews);

const review = (overrides: Record<string, unknown> = {}) => ({
  id: "rev-1",
  rating: 5,
  comment: "The fit was perfect.",
  customerName: "Ada L.",
  publishedAt: "2026-07-04T09:30:00.000Z",
  ...overrides,
});

describe("GET /api/reviews", () => {
  it("returns the published testimonials", async () => {
    mockList.mockResolvedValue([review()]);

    const res = await request(app).get("/api/reviews");

    expect(res.status).toBe(200);
    expect(res.body.reviews).toHaveLength(1);
    expect(res.body.reviews[0]).toMatchObject({
      id: "rev-1",
      rating: 5,
      comment: "The fit was perfect.",
      customerName: "Ada L.",
    });
  });

  it("returns an empty list when nothing has been published", async () => {
    mockList.mockResolvedValue([]);

    const res = await request(app).get("/api/reviews");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reviews: [] });
  });

  it("defaults the limit when the caller doesn't ask for one", async () => {
    mockList.mockResolvedValue([]);

    await request(app).get("/api/reviews");

    expect(mockList).toHaveBeenCalledWith(12);
  });

  it("passes a requested limit through", async () => {
    mockList.mockResolvedValue([]);

    await request(app).get("/api/reviews?limit=3");

    expect(mockList).toHaveBeenCalledWith(3);
  });

  it("rejects a limit outside the contract's range", async () => {
    mockList.mockResolvedValue([]);

    const res = await request(app).get("/api/reviews?limit=500");

    expect(res.status).toBe(400);
    expect(mockList).not.toHaveBeenCalled();
  });

  it("lets the edge CDN cache the list", async () => {
    mockList.mockResolvedValue([]);

    const res = await request(app).get("/api/reviews");

    expect(res.headers["cache-control"]).toContain("s-maxage");
    expect(res.headers["cdn-cache-control"]).toContain("s-maxage");
  });

  it("does not cache an error response", async () => {
    mockList.mockRejectedValue(new Error("notion down"));

    const res = await request(app).get("/api/reviews");

    expect(res.status).toBe(500);
    expect(res.headers["cache-control"]).toBeUndefined();
    expect(res.headers["cdn-cache-control"]).toBeUndefined();
  });
});
