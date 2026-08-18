import { describe, it, expect } from "vitest";
import { createOrderInput } from "@workspace/test-fixtures";
import {
  buildOrderProperties,
  buildOrderPageBlocks,
} from "../../src/lib/notion/orders.blocks.js";
import type { CreateOrderInput } from "../../src/lib/notion/orders.schema.js";

const baseOrder: CreateOrderInput = createOrderInput();

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

/** The file_upload ids of any image blocks, in order. */
function imageUploadIds(blocks: unknown[]): string[] {
  return (blocks as any[])
    .filter((b) => b.type === "image")
    .map((b) => b.image.file_upload.id);
}

describe("buildOrderProperties", () => {
  it("maps to the live Notion property types (title + rich_text, not number)", () => {
    const props = buildOrderProperties(baseOrder, "ORD-ABC-123") as any;

    // "Order Name" is the Notion title property.
    expect(props["Order Name"].title[0].text.content).toBe(
      "Ada Lovelace – Custom Costume",
    );
    // "Order Number" is rich_text — NOT a number — so leading-zero ids survive.
    expect(props["Order Number"].rich_text[0].text.content).toBe("ORD-ABC-123");
    expect(props["Order Number"]).not.toHaveProperty("number");
  });

  it("omits the Client relation when no client page id is given", () => {
    const props = buildOrderProperties(baseOrder, "ORD-ABC-123") as any;
    expect(props).not.toHaveProperty("Client");
  });

  it("links the order to the Client CRM record when a client page id is given", () => {
    const props = buildOrderProperties(
      baseOrder,
      "ORD-ABC-123",
      "client-9",
    ) as any;
    expect(props["Client"].relation).toEqual([{ id: "client-9" }]);
  });

  it("seeds the Due Date property from the customer's neededBy date", () => {
    const props = buildOrderProperties(
      { ...baseOrder, neededBy: new Date("2026-09-01T12:34:56Z") },
      "ORD-ABC-123",
    ) as any;
    expect(props["Due Date"].date.start).toBe("2026-09-01");
  });

  it("omits the Due Date property when no neededBy date is provided", () => {
    const props = buildOrderProperties(baseOrder, "ORD-ABC-123") as any;
    expect(props).not.toHaveProperty("Due Date");
  });

  it("sets the Rush Order checkbox when the order is a rush", () => {
    const props = buildOrderProperties(
      { ...baseOrder, rush: true },
      "ORD-ABC-123",
    ) as any;
    expect(props["Rush Order"].checkbox).toBe(true);
  });

  it("omits the Rush Order checkbox for a standard-timeline order", () => {
    const props = buildOrderProperties(baseOrder, "ORD-ABC-123") as any;
    expect(props).not.toHaveProperty("Rush Order");
  });

  it("writes the measurement values as typed properties (bust → Chest) + unit select", () => {
    const props = buildOrderProperties(
      { ...baseOrder, measurementUnit: "cm" },
      "ORD-ABC-123",
    ) as any;
    expect(props["Waist"].number).toBe(28);
    expect(props["Chest"].number).toBe(36); // the contract's `bust`
    expect(props["Hips"].number).toBe(38);
    expect(props["Height"].number).toBe(65);
    expect(props["Body Girth"].number).toBe(32);
    expect(props["Measurement Unit"].select.name).toBe("cm");
  });

  it("omits the measurement properties for a measure-at-fitting order", () => {
    const {
      waist,
      bust,
      hips,
      height,
      bodyGirth,
      measurementUnit,
      ...contact
    } = baseOrder;
    const props = buildOrderProperties(
      { ...contact, measurementAppointment: true },
      "ORD-ABC-123",
    ) as any;
    expect(props).not.toHaveProperty("Waist");
    expect(props).not.toHaveProperty("Chest");
    expect(props).not.toHaveProperty("Measurement Unit");
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
      "Costume Details",
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
      Chest: "36",
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

  it("notes a rush order in the body, and omits it otherwise", () => {
    const rushPairs = textPairs(
      buildOrderPageBlocks({ ...baseOrder, rush: true }),
    );
    expect(rushPairs["Rush Order"]).toMatch(/surcharge applies/i);

    const standardPairs = textPairs(buildOrderPageBlocks(baseOrder));
    expect(standardPairs).not.toHaveProperty("Rush Order");
  });

  it("renders an appointment note instead of values when measurements are omitted", () => {
    const {
      waist,
      bust,
      hips,
      height,
      bodyGirth,
      measurementUnit,
      ...contact
    } = baseOrder;
    const blocks = buildOrderPageBlocks({
      ...contact,
      measurementAppointment: true,
    });

    // The heading carries no unit, and none of the numeric fields appear.
    expect(headings(blocks)).toEqual([
      "Contact Information",
      "Measurements",
      "Costume Details",
    ]);
    const pairs = textPairs(blocks);
    expect(pairs).not.toHaveProperty("Waist");
    expect(pairs).not.toHaveProperty("Body Girth");
    expect(pairs.Status).toMatch(/fitting or consultation/i);
  });

  it("omits the Reference Images section when no image ids are provided", () => {
    const blocks = buildOrderPageBlocks(baseOrder);
    expect(headings(blocks)).not.toContain("Reference Images");
    expect(imageUploadIds(blocks)).toEqual([]);
  });

  it("appends a Reference Images section of image blocks by file_upload id", () => {
    const blocks = buildOrderPageBlocks({
      ...baseOrder,
      referenceImageIds: ["upload-1", "upload-2"],
    });
    expect(headings(blocks)).toEqual([
      "Contact Information",
      "Measurements (inches)",
      "Costume Details",
      "Reference Images",
    ]);
    expect(imageUploadIds(blocks)).toEqual(["upload-1", "upload-2"]);
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

describe("color selections", () => {
  const withColors: CreateOrderInput = {
    ...baseOrder,
    colors: ["Emerald", "Blush", "Gold Foil"],
    colorUsage: "Emerald bodice, gold accents on the collar, blush skirt.",
  };

  it("writes the picked colors as a multi_select and the usage as rich_text", () => {
    const props = buildOrderProperties(withColors, "ORD-1") as any;
    expect(props["Colors"].multi_select).toEqual([
      { name: "Emerald" },
      { name: "Blush" },
      { name: "Gold Foil" },
    ]);
    expect(props["Color Usage"].rich_text[0].text.content).toBe(
      "Emerald bodice, gold accents on the collar, blush skirt.",
    );
  });

  it("omits the color properties when nothing was picked", () => {
    const props = buildOrderProperties(baseOrder, "ORD-1") as any;
    expect(props).not.toHaveProperty("Colors");
    expect(props).not.toHaveProperty("Color Usage");
  });

  it("renders the colors + usage as page-body blocks", () => {
    const pairs = textPairs(buildOrderPageBlocks(withColors));
    expect(pairs["Colors"]).toBe("Emerald, Blush, Gold Foil");
    expect(pairs["Color Usage"]).toBe(
      "Emerald bodice, gold accents on the collar, blush skirt.",
    );
  });

  it("adds no color blocks when nothing was picked", () => {
    const pairs = textPairs(buildOrderPageBlocks(baseOrder));
    expect(pairs).not.toHaveProperty("Colors");
    expect(pairs).not.toHaveProperty("Color Usage");
  });
});
