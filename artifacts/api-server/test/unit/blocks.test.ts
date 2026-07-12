import { describe, it, expect } from "vitest";
import {
  buildOrderProperties,
  buildOrderPageBlocks,
} from "../../src/lib/notion/blocks.js";
import type { CreateOrderInput } from "../../src/lib/notion/schema.js";

const baseOrder: CreateOrderInput = {
  fullName: "Ada Lovelace",
  email: "ada@example.com",
  phone: "+1 555 000 1234",
  preferredContact: "email",
  measurementUnit: "inches",
  waist: 28,
  bust: 36,
  hips: 38,
  height: 65,
  bodyGirth: 32,
};

/** Collect the "Label: value" pairs out of the paragraph blocks. */
function textPairs(blocks: unknown[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const block of blocks as any[]) {
    if (block.type !== "paragraph") continue;
    const [labelRun, valueRun] = block.paragraph.rich_text;
    const label = labelRun.text.content.replace(/: $/, "");
    out[label] = valueRun?.text.content ?? "";
  }
  return out;
}

function headings(blocks: unknown[]): string[] {
  return (blocks as any[])
    .filter((b) => b.type === "heading_2")
    .map((b) => b.heading_2.rich_text[0].text.content);
}

describe("buildOrderProperties", () => {
  it("maps to the live Notion property types (title + rich_text, not number)", () => {
    const props = buildOrderProperties(baseOrder, "ORD-ABC-123") as any;

    // "Order Name" is the Notion title property.
    expect(props["Order Name"].title[0].text.content).toBe(
      "Ada Lovelace – Custom Dress",
    );
    // "Order Number" is rich_text — NOT a number — so leading-zero ids survive.
    expect(props["Order Number"].rich_text[0].text.content).toBe("ORD-ABC-123");
    expect(props["Order Number"]).not.toHaveProperty("number");
  });
});

describe("buildOrderPageBlocks", () => {
  it("emits the three sections with the measurement unit in the heading", () => {
    const blocks = buildOrderPageBlocks({
      ...baseOrder,
      measurementUnit: "cm",
    });
    expect(headings(blocks)).toEqual([
      "Contact Information",
      "Measurements (cm)",
      "Dress Details",
    ]);
  });

  it("includes all contact and measurement values", () => {
    const pairs = textPairs(buildOrderPageBlocks(baseOrder));
    expect(pairs).toMatchObject({
      "Full Name": "Ada Lovelace",
      Email: "ada@example.com",
      Phone: "+1 555 000 1234",
      "Preferred Contact": "email",
      Waist: "28",
      Bust: "36",
      Hips: "38",
      Height: "65",
      "Body Girth": "32",
    });
  });

  it("omits Description and Needed By when they are not provided", () => {
    const pairs = textPairs(buildOrderPageBlocks(baseOrder));
    expect(pairs).not.toHaveProperty("Description");
    expect(pairs).not.toHaveProperty("Needed By");
  });

  it("includes Description when provided", () => {
    const pairs = textPairs(
      buildOrderPageBlocks({ ...baseOrder, description: "Ivory chiffon" }),
    );
    expect(pairs.Description).toBe("Ivory chiffon");
  });

  it("formats a Date neededBy as an ISO date (YYYY-MM-DD)", () => {
    const pairs = textPairs(
      buildOrderPageBlocks({
        ...baseOrder,
        neededBy: new Date("2026-09-01T12:34:56Z"),
      }),
    );
    expect(pairs["Needed By"]).toBe("2026-09-01");
  });

  it("stringifies a non-Date neededBy as-is", () => {
    const pairs = textPairs(
      buildOrderPageBlocks({
        ...baseOrder,
        // The contract coerces to Date, but the builder defends against a raw
        // string reaching it; pin that fallback.
        neededBy: "2026-09-01" as unknown as Date,
      }),
    );
    expect(pairs["Needed By"]).toBe("2026-09-01");
  });
});
