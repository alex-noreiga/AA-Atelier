import { describe, it, expect } from "vitest";
import { reviewPage } from "../support/fake-notion.js";
import {
  extractReview,
  extractIsPublished,
} from "../../src/lib/notion/reviews.schema.js";

describe("extractReview", () => {
  it("maps each live Notion property to the review DTO", () => {
    const review = extractReview(
      reviewPage({
        id: "r1",
        name: "Ada Lovelace",
        rating: 5,
        body: "Exquisite work.",
        title: "Loved it",
        createdTime: "2026-01-15T12:00:00.000Z",
      }) as never,
    );

    expect(review).toEqual({
      id: "r1",
      name: "Ada Lovelace",
      rating: 5,
      body: "Exquisite work.",
      title: "Loved it",
      date: "2026-01-15T12:00:00.000Z",
    });
  });

  it("omits the title when the property is empty", () => {
    const review = extractReview(reviewPage({ name: "Grace" }) as never);
    expect(review).not.toHaveProperty("title");
  });

  it("clamps an out-of-range or fractional rating into 1..5", () => {
    expect(extractReview(reviewPage({ rating: 9 }) as never).rating).toBe(5);
    expect(extractReview(reviewPage({ rating: 0 }) as never).rating).toBe(1);
    expect(extractReview(reviewPage({ rating: 4.4 }) as never).rating).toBe(4);
  });

  it("defaults a missing rating to the top of the range", () => {
    expect(extractReview(reviewPage({ rating: null }) as never).rating).toBe(5);
  });
});

describe("extractIsPublished", () => {
  it("reflects the Published checkbox", () => {
    expect(extractIsPublished(reviewPage({ published: true }) as never)).toBe(
      true,
    );
    expect(extractIsPublished(reviewPage({ published: false }) as never)).toBe(
      false,
    );
  });
});
