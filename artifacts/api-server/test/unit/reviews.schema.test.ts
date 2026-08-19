import { describe, it, expect } from "vitest";
import {
  extractPublishedReviews,
  isPublishable,
  REVIEW_STATUS_PUBLISHED,
  type NotionReviewPage,
} from "../../src/lib/notion/reviews.schema.js";
import { reviewPage } from "../support/fake-notion.js";

const page = (opts: Parameters<typeof reviewPage>[0] = {}) =>
  reviewPage(opts) as NotionReviewPage;

// The publish gates are the whole safety story for this feature: a review is a
// real customer's words, and showing one they didn't consent to (or that the
// atelier hadn't curated) is not recoverable by a later fix.
describe("isPublishable", () => {
  it("passes only when the atelier published it AND the customer consented", () => {
    expect(isPublishable(page())).toBe(true);
  });

  it("rejects a consented review still sitting in triage", () => {
    expect(isPublishable(page({ status: "New" }))).toBe(false);
  });

  it("rejects a published review the customer did not consent to", () => {
    expect(isPublishable(page({ consent: false }))).toBe(false);
  });

  it("rejects a row with no status set at all", () => {
    expect(isPublishable(page({ status: null }))).toBe(false);
  });

  it("rejects when the properties are missing entirely (fails closed)", () => {
    expect(isPublishable({ id: "x", properties: {} })).toBe(false);
  });

  it("is case-sensitive on the published option name", () => {
    expect(isPublishable(page({ status: "published" }))).toBe(false);
    expect(isPublishable(page({ status: REVIEW_STATUS_PUBLISHED }))).toBe(true);
  });
});

describe("extractPublishedReviews", () => {
  it("maps a published row to its public projection", () => {
    const [review] = extractPublishedReviews([
      page({
        id: "rev-1",
        rating: 5,
        comment: "The fit was perfect.",
        customerName: "Ada L.",
        createdTime: "2026-07-04T09:30:00.000Z",
      }),
    ]);

    expect(review).toEqual({
      id: "rev-1",
      rating: 5,
      comment: "The fit was perfect.",
      customerName: "Ada L.",
      publishedAt: "2026-07-04T09:30:00.000Z",
    });
  });

  it("never carries the email, order number, or verification flag", () => {
    const withPrivateFields: NotionReviewPage = {
      ...page({ id: "rev-2" }),
      properties: {
        ...page({ id: "rev-2" }).properties,
        Email: {
          type: "rich_text",
          rich_text: [{ plain_text: "ada@example.com" }],
        },
        "Order Number": {
          type: "rich_text",
          rich_text: [{ plain_text: "000002" }],
        },
      },
    };

    const [review] = extractPublishedReviews([withPrivateFields]);

    expect(Object.keys(review).sort()).toEqual([
      "comment",
      "id",
      "publishedAt",
      "rating",
    ]);
  });

  it("omits customerName when the customer asked not to be credited", () => {
    const [review] = extractPublishedReviews([page({ customerName: "" })]);
    expect(review).not.toHaveProperty("customerName");
  });

  it("omits publishedAt when Notion returned no created_time", () => {
    const [review] = extractPublishedReviews([page({ createdTime: null })]);
    expect(review).not.toHaveProperty("publishedAt");
  });

  it("drops rows that fail either publish gate", () => {
    const records = extractPublishedReviews([
      page({ id: "keep" }),
      page({ id: "triage", status: "New" }),
      page({ id: "unconsented", consent: false }),
    ]);

    expect(records.map((r) => r.id)).toEqual(["keep"]);
  });

  it("drops a published row with no testimonial text", () => {
    expect(extractPublishedReviews([page({ comment: "" })])).toEqual([]);
  });

  it("clamps a missing or out-of-range rating into the contract's 1-5", () => {
    const ratings = extractPublishedReviews([
      page({ id: "a", rating: null }),
      page({ id: "b", rating: 0 }),
      page({ id: "c", rating: 9 }),
      page({ id: "d", rating: 4.4 }),
    ]).map((r) => r.rating);

    expect(ratings).toEqual([5, 1, 5, 4]);
  });
});
