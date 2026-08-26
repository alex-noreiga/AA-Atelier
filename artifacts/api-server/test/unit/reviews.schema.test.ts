import { describe, it, expect } from "vitest";
import {
  extractImageUrls,
  extractProductReviews,
  extractPublishedReviews,
  extractStudioReview,
  extractStudioReviews,
  isPublishable,
  reviewModeration,
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

// The staff projection is the mirror image of the public one: the public
// extractor's job is to let nothing through that shouldn't be seen, and this
// one's is to let nothing be hidden from the person deciding.
describe("reviewModeration", () => {
  it("reads the two values the app writes", () => {
    expect(reviewModeration(page({ status: "Published" }))).toBe("published");
    expect(reviewModeration(page({ status: "Rejected" }))).toBe("rejected");
  });

  it("treats the capture default as pending", () => {
    expect(reviewModeration(page({ status: "New" }))).toBe("pending");
  });

  // "Archived" is how a review was retired before the queue existed, so the
  // queue must not reopen every one of them as undecided.
  it("reads the pre-existing Archived status as already set aside", () => {
    expect(reviewModeration(page({ status: "Archived" }))).toBe("rejected");
  });

  it("treats a blank or unrecognized status as pending, never as published", () => {
    expect(reviewModeration(page({ status: null }))).toBe("pending");
    expect(reviewModeration(page({ status: "Featured" }))).toBe("pending");
    expect(reviewModeration(page({ status: "published" }))).toBe("pending");
    expect(reviewModeration({ id: "x", properties: {} })).toBe("pending");
  });
});

// The shop-piece projection. It shares `isPublishable` with the testimonials
// above, which is the whole point: one predicate decides everything public, so a
// star rating can never appear beside a piece from a row the testimonial strip
// couldn't show.
describe("extractProductReviews", () => {
  it("keeps a published row that names a piece, with the ids it names", () => {
    const [review] = extractProductReviews([
      page({ id: "rev-1", rating: 4, productIds: ["inv-a", "inv-b"] }),
    ]);

    expect(review).toMatchObject({
      id: "rev-1",
      rating: 4,
      productIds: ["inv-a", "inv-b"],
    });
  });

  it("drops a review of a custom order, which names no piece", () => {
    expect(extractProductReviews([page({ productIds: [] })])).toEqual([]);
  });

  it("drops every row when the database has no Product column at all", () => {
    expect(extractProductReviews([page({ productIds: null })])).toEqual([]);
  });

  it("drops a row still in triage, however many pieces it names", () => {
    expect(
      extractProductReviews([page({ status: "New", productIds: ["inv-a"] })]),
    ).toEqual([]);
  });

  it("drops a row the customer never consented to publish", () => {
    expect(
      extractProductReviews([page({ consent: false, productIds: ["inv-a"] })]),
    ).toEqual([]);
  });

  // Unlike the testimonial extractor: a rating with no words still counts
  // toward the average, it just has nothing to quote.
  it("keeps a rating with no testimonial text", () => {
    const [review] = extractProductReviews([
      page({ comment: "", productIds: ["inv-a"] }),
    ]);

    expect(review).toMatchObject({ comment: "", rating: 5 });
  });

  it("clamps a nonsense rating into 1-5 rather than failing the read", () => {
    const [review] = extractProductReviews([
      page({ rating: 47, productIds: ["inv-a"] }),
    ]);

    expect(review.rating).toBe(5);
  });
});

describe("extractStudioReview", () => {
  it("maps the whole row, including what the public projection withholds", () => {
    expect(
      extractStudioReview(
        page({
          id: "rev-9",
          rating: 4,
          comment: "Gorgeous.",
          customerName: "Ada L.",
          orderNumber: "000014",
          email: "ada@example.com",
          emailVerified: false,
          status: "New",
          consent: true,
          createdTime: "2026-07-04T09:30:00.000Z",
          url: "https://notion.so/rev-9",
        }),
      ),
    ).toEqual({
      id: "rev-9",
      rating: 4,
      comment: "Gorgeous.",
      customerName: "Ada L.",
      orderNumber: "000014",
      email: "ada@example.com",
      emailVerified: false,
      consentToPublish: true,
      status: "pending",
      rawStatus: "New",
      submittedAt: "2026-07-04T09:30:00.000Z",
      notionUrl: "https://notion.so/rev-9",
    });
  });

  it("keeps a review with no testimonial text — that is the one to reject", () => {
    const review = extractStudioReview(page({ comment: "" }));
    expect(review.comment).toBe("");
  });

  it("clamps a nonsense rating rather than failing the whole response", () => {
    expect(extractStudioReview(page({ rating: 99 })).rating).toBe(5);
    expect(extractStudioReview(page({ rating: null })).rating).toBe(5);
    expect(extractStudioReview(page({ rating: 0 })).rating).toBe(1);
  });

  it("omits the optional fields it has no value for", () => {
    const review = extractStudioReview(
      page({
        customerName: "",
        orderNumber: "",
        email: null,
        status: null,
        createdTime: null,
        url: null,
      }),
    );
    expect(review.customerName).toBeUndefined();
    expect(review.orderNumber).toBeUndefined();
    expect(review.email).toBeUndefined();
    expect(review.rawStatus).toBeUndefined();
    expect(review.submittedAt).toBeUndefined();
    expect(review.notionUrl).toBeUndefined();
  });

  it("drops nothing — every row comes back, unlike the public extractor", () => {
    const pages = [page({ status: "New" }), page({ consent: false }), page()];
    expect(extractStudioReviews(pages)).toHaveLength(3);
    expect(extractPublishedReviews(pages)).toHaveLength(1);
  });
});

describe("extractImageUrls", () => {
  it("reads Notion-hosted and external images, in body order", () => {
    expect(
      extractImageUrls([
        { type: "quote" },
        { type: "image", image: { file: { url: "https://notion/1.png" } } },
        { type: "image", image: { external: { url: "https://cdn/2.png" } } },
      ]),
    ).toEqual(["https://notion/1.png", "https://cdn/2.png"]);
  });

  it("ignores an image block with no url and any non-image block", () => {
    expect(
      extractImageUrls([
        { type: "image", image: {} },
        { type: "paragraph" },
        {},
      ]),
    ).toEqual([]);
  });
});
