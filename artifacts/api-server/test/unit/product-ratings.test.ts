import { describe, it, expect } from "vitest";
import { summarizeProductRatings } from "../../src/services/product-ratings.js";
import type { ProductRecord } from "../../src/lib/notion/products.schema.js";
import type { ProductReviewRecord } from "../../src/lib/notion/reviews.schema.js";

function product(id: string): ProductRecord {
  return { id, title: id, category: "Soakers", sized: false, variants: [] };
}

function review(
  id: string,
  rating: number,
  productIds: string[],
  comment = "Lovely.",
): ProductReviewRecord {
  return { id, rating, comment, productIds };
}

/** The join the shop does: an inventory row belongs to the card it was grouped
 * onto. `inv-a` and `inv-b` are two colourways of one grouped card. */
const CARD_OF: Record<string, string> = {
  "inv-a": "group-aurora",
  "inv-b": "group-aurora",
  "inv-c": "inv-c",
};
const cardIdFor = (variantId: string) => CARD_OF[variantId];

describe("summarizeProductRatings", () => {
  it("averages a card's reviews to one decimal place", () => {
    const summaries = summarizeProductRatings(
      [product("inv-c")],
      [review("r1", 5, ["inv-c"]), review("r2", 4, ["inv-c"])],
      cardIdFor,
    );

    expect(summaries.get("inv-c")).toMatchObject({ average: 4.5, count: 2 });
  });

  it("rounds a repeating average rather than serving it raw", () => {
    const summaries = summarizeProductRatings(
      [product("inv-c")],
      [
        review("r1", 5, ["inv-c"]),
        review("r2", 5, ["inv-c"]),
        review("r3", 4, ["inv-c"]),
      ],
      cardIdFor,
    );

    expect(summaries.get("inv-c")?.average).toBe(4.7);
  });

  // A shopper reading "Aurora Soaker" wants what buyers of the Aurora Soaker
  // thought, not what buyers of the pink one alone did.
  it("pools the reviews of every variant under one grouped card", () => {
    const summaries = summarizeProductRatings(
      [product("group-aurora")],
      [review("r1", 5, ["inv-a"]), review("r2", 3, ["inv-b"])],
      cardIdFor,
    );

    expect(summaries.get("group-aurora")).toMatchObject({
      average: 4,
      count: 2,
    });
  });

  // The relation permits several pieces on one review. Counting it once per
  // inventory row would let one review inflate a card whose colourways it named.
  it("counts a review once per card, however many of its variants it names", () => {
    const summaries = summarizeProductRatings(
      [product("group-aurora")],
      [review("r1", 5, ["inv-a", "inv-b"])],
      cardIdFor,
    );

    expect(summaries.get("group-aurora")?.count).toBe(1);
  });

  it("counts a review naming two different pieces for both of them", () => {
    const summaries = summarizeProductRatings(
      [product("group-aurora"), product("inv-c")],
      [review("r1", 4, ["inv-a", "inv-c"])],
      cardIdFor,
    );

    expect(summaries.get("group-aurora")?.count).toBe(1);
    expect(summaries.get("inv-c")?.count).toBe(1);
  });

  // Nothing to show it beside.
  it("drops a review whose piece has no card on the shop", () => {
    const summaries = summarizeProductRatings(
      [product("inv-c")],
      [review("r1", 5, ["inv-retired"])],
      cardIdFor,
    );

    expect(summaries.size).toBe(0);
  });

  it("gives a piece with no reviews no summary at all, rather than a zeroed one", () => {
    const summaries = summarizeProductRatings(
      [product("inv-c")],
      [],
      cardIdFor,
    );
    expect(summaries.has("inv-c")).toBe(false);
  });

  it("quotes at most three reviews, newest first", () => {
    const summaries = summarizeProductRatings(
      [product("inv-c")],
      [
        review("r1", 5, ["inv-c"], "Newest"),
        review("r2", 5, ["inv-c"], "Second"),
        review("r3", 5, ["inv-c"], "Third"),
        review("r4", 5, ["inv-c"], "Oldest"),
      ],
      cardIdFor,
    );

    const summary = summaries.get("inv-c");
    expect(summary?.count).toBe(4);
    expect(summary?.reviews.map((r) => r.comment)).toEqual([
      "Newest",
      "Second",
      "Third",
    ]);
  });

  // A rating with no words is still a rating; it just has nothing to quote.
  it("counts a comment-less review but never quotes it", () => {
    const summaries = summarizeProductRatings(
      [product("inv-c")],
      [review("r1", 4, ["inv-c"], ""), review("r2", 2, ["inv-c"], "")],
      cardIdFor,
    );

    expect(summaries.get("inv-c")).toMatchObject({
      average: 3,
      count: 2,
      reviews: [],
    });
  });

  it("does not leak the piece ids into the quoted reviews", () => {
    const summaries = summarizeProductRatings(
      [product("inv-c")],
      [review("r1", 5, ["inv-c"])],
      cardIdFor,
    );

    expect(summaries.get("inv-c")?.reviews[0]).not.toHaveProperty("productIds");
  });
});
