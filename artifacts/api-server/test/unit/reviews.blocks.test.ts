import { describe, it, expect } from "vitest";
import { reviewInput } from "@workspace/test-fixtures";
import {
  buildReviewProperties,
  buildReviewPageBlocks,
  type ReviewRow,
} from "../../src/lib/notion/reviews.blocks.js";

function row(overrides: Partial<ReviewRow> = {}): ReviewRow {
  return {
    orderNumber: "000002",
    emailVerified: true,
    request: reviewInput(),
    ...overrides,
  };
}

describe("buildReviewProperties", () => {
  it("maps each field to the correct live reviews-database property type", () => {
    const props = buildReviewProperties(row()) as any;

    // number (not rich_text) — the star rating
    expect(props.Rating).toEqual({ number: 5 });
    // rich_text — the testimonial
    expect(props.Review.rich_text[0].text.content).toBe(
      "Absolutely stunning craftsmanship — it fit like a dream.",
    );
    // rich_text — the order it's for
    expect(props["Order Number"].rich_text[0].text.content).toBe("000002");
    // email property (not rich_text)
    expect(props.Email).toEqual({ email: "ada@example.com" });
    // select, defaulted to "New" so the atelier curates before publishing
    expect(props.Status).toEqual({ select: { name: "New" } });
  });

  it("titles the row with stars, the credit, and the order number", () => {
    const props = buildReviewProperties(
      row({ request: reviewInput({ rating: 4, displayName: "Ada L." }) }),
    ) as any;
    expect(props.Title.title[0].text.content).toBe(
      "★★★★☆ — Ada L. (order 000002)",
    );
  });

  it('titles an un-credited review "Anonymous"', () => {
    const props = buildReviewProperties(row()) as any;
    expect(props.Title.title[0].text.content).toBe(
      "★★★★★ — Anonymous (order 000002)",
    );
  });

  it("records the publish consent as a checkbox (defaulting to false)", () => {
    const consented = buildReviewProperties(
      row({ request: reviewInput({ consentToPublish: true }) }),
    ) as any;
    expect(consented["Consent to Publish"]).toEqual({ checkbox: true });

    const noConsent = buildReviewProperties(row()) as any;
    expect(noConsent["Consent to Publish"]).toEqual({ checkbox: false });
  });

  it("flags whether the email was verified so the atelier can vet legacy orders", () => {
    expect(
      (buildReviewProperties(row({ emailVerified: true })) as any)[
        "Email Verified"
      ],
    ).toEqual({ checkbox: true });
    expect(
      (buildReviewProperties(row({ emailVerified: false })) as any)[
        "Email Verified"
      ],
    ).toEqual({ checkbox: false });
  });

  it("writes the credit name only when a display name is given", () => {
    const credited = buildReviewProperties(
      row({ request: reviewInput({ displayName: "  Ada L.  " }) }),
    ) as any;
    expect(credited["Customer Name"].rich_text[0].text.content).toBe("Ada L.");

    const anon = buildReviewProperties(row()) as any;
    expect(anon).not.toHaveProperty("Customer Name");
  });

  it("links to the Client CRM record when a client page id is given", () => {
    const props = buildReviewProperties(row(), "client-7") as any;
    expect(props.Client).toEqual({ relation: [{ id: "client-7" }] });
  });

  it("omits the Client relation when no client page id is given", () => {
    const props = buildReviewProperties(row()) as any;
    expect(props).not.toHaveProperty("Client");
  });

  it("links the order via the `Order` relation when a page id is given", () => {
    const props = buildReviewProperties(
      row({ orderPageId: "order-page-4" }),
    ) as any;
    expect(props.Order).toEqual({ relation: [{ id: "order-page-4" }] });
  });

  it("omits the `Order` relation when no order page id is given", () => {
    const props = buildReviewProperties(row()) as any;
    expect(props).not.toHaveProperty("Order");
  });
});

describe("buildReviewPageBlocks", () => {
  it("renders the testimonial as a quote block", () => {
    const blocks = buildReviewPageBlocks(row()) as any[];
    expect(blocks[0].type).toBe("quote");
    expect(blocks[0].quote.rich_text[0].text.content).toBe(
      "Absolutely stunning craftsmanship — it fit like a dream.",
    );
  });

  it("attaches each photo as an image block by its file_upload id", () => {
    const blocks = buildReviewPageBlocks(
      row({ request: reviewInput({ photoIds: ["up-1", "up-2"] }) }),
    ) as any[];
    const images = blocks.filter((b) => b.type === "image");
    expect(images).toHaveLength(2);
    expect(images[0].image).toEqual({
      type: "file_upload",
      file_upload: { id: "up-1" },
    });
  });

  it("has no image blocks when no photos were uploaded", () => {
    const blocks = buildReviewPageBlocks(row()) as any[];
    expect(blocks.some((b) => b.type === "image")).toBe(false);
  });
});
