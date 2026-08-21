import { test, expect } from "@playwright/test";

// The curated testimonials read — `GET /api/reviews` against the live Notion
// "Reviews" database, rendered by `components/testimonials.tsx` on the home and
// about pages.
//
// This is the highest-value read to monitor precisely BECAUSE it is the one
// designed to fail invisibly. Every other data path on the site announces a
// problem: the shop renders `shop-error`, an order lookup renders
// `status-error`. The testimonial strip renders NOTHING — `testimonials.tsx`
// returns null while loading, on error, and when nothing is published, so the
// section is simply absent rather than advertising a hole (a deliberate design
// choice — see CLAUDE.md, "Showing the curated reviews"). A broken read
// therefore produces no error state, no empty state, no log the atelier sees,
// and no visual difference from "we haven't published any yet".
//
// Read-only: a GET of already-published, already-consented testimonials. The
// response is a narrow projection that deliberately excludes the reviewer's
// email and order number, so nothing sensitive is fetched either.

// Opt-in strictness. The endpoint is degrade-safe by design — `listPublishedReviews`
// returns [] rather than throwing when the database id is unset or Notion fails
// — so a 200 with an empty list is genuinely ambiguous: it means EITHER "nothing
// is published" OR "the Notion read failed". The API cannot tell those apart, so
// neither can this test. Once the atelier has testimonials live on the site, set
// SMOKE_EXPECT_REVIEWS=1 and this asserts the list is actually non-empty, which
// is what turns the ambiguous signal into a real one. Same gating pattern as
// SMOKE_KNOWN_ORDER_NUMBER in order-success.smoke.ts.
const EXPECT_REVIEWS = process.env.SMOKE_EXPECT_REVIEWS === "1";

type PublishedReview = {
  id?: string;
  rating?: number;
  comment?: string;
  customerName?: string;
  publishedAt?: string;
};

test.describe("Production smoke: published reviews", () => {
  test("the testimonials read answers with a well-formed list", async ({
    request,
  }) => {
    const res = await request.get("/api/reviews");
    expect(
      res.status(),
      "GET /api/reviews did not answer 200 — the marketing pages would silently drop their testimonial strip",
    ).toBe(200);

    const body = (await res.json()) as { reviews?: PublishedReview[] };
    expect(Array.isArray(body.reviews)).toBe(true);

    const reviews = body.reviews ?? [];

    if (EXPECT_REVIEWS) {
      expect(
        reviews.length,
        "SMOKE_EXPECT_REVIEWS=1 but the site is serving no testimonials — either the Notion read is failing or every review was unpublished",
      ).toBeGreaterThan(0);
    }

    // Shape-check whatever came back. A malformed row would render as a broken
    // quote card rather than an error, so the shape IS the regression signal.
    for (const review of reviews) {
      expect(typeof review.id).toBe("string");
      expect(typeof review.rating).toBe("number");
      expect(review.rating).toBeGreaterThanOrEqual(1);
      expect(review.rating).toBeLessThanOrEqual(5);
      expect(typeof review.comment).toBe("string");

      // The two gates are server-side, so we cannot re-check them here — but we
      // CAN check the projection never leaks what it promised to withhold. If
      // these ever appear, the response mapping has widened past the contract.
      expect(review).not.toHaveProperty("email");
      expect(review).not.toHaveProperty("orderNumber");
      expect(review).not.toHaveProperty("emailVerified");
    }
  });
});
