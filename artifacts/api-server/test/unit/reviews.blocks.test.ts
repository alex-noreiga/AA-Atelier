import { describe, it, expect } from "vitest";
import { reviewInput } from "@workspace/test-fixtures";
import { buildReviewProperties } from "../../src/lib/notion/reviews.blocks.js";

describe("buildReviewProperties", () => {
  it("maps each field to the correct live Notion property type", () => {
    const props = buildReviewProperties({
      verified: true,
      orderReference: "000002",
      review: reviewInput({ orderNumber: "000002", title: "Loved it" }),
    }) as any;

    // title
    expect(props.Name.title[0].text.content).toBe("Ada Lovelace");
    // number
    expect(props.Rating).toEqual({ number: 5 });
    // rich_text
    expect(props.Review.rich_text[0].text.content).toBe(
      "The dress was exquisite and fit perfectly.",
    );
    expect(props.Title.rich_text[0].text.content).toBe("Loved it");
    // email property (not rich_text)
    expect(props.Email).toEqual({ email: "ada@example.com" });
    // rich_text order reference (the custom order number here)
    expect(props["Order Number"].rich_text[0].text.content).toBe("000002");
    // verification flag
    expect(props.Verified).toEqual({ checkbox: true });
  });

  it("writes the order reference (a shop session id) even when no order number was sent", () => {
    const props = buildReviewProperties({
      verified: true,
      orderReference: "cs_test_123",
      review: reviewInput({ orderNumber: undefined }),
    }) as any;
    expect(props["Order Number"].rich_text[0].text.content).toBe("cs_test_123");
  });

  it("always writes Published unchecked (moderation gate)", () => {
    const props = buildReviewProperties({
      verified: true,
      orderReference: "ORD-1",
      review: reviewInput(),
    }) as any;
    expect(props.Published).toEqual({ checkbox: false });
  });

  it("records an unverified submission", () => {
    const props = buildReviewProperties({
      verified: false,
      orderReference: "ORD-1",
      review: reviewInput(),
    }) as any;
    expect(props.Verified).toEqual({ checkbox: false });
  });

  it("omits the Title property when no title is provided", () => {
    const props = buildReviewProperties({
      verified: true,
      orderReference: "ORD-1",
      review: reviewInput(),
    }) as any;
    expect(props).not.toHaveProperty("Title");
  });
});
