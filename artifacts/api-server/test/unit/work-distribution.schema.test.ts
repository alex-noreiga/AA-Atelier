import { describe, it, expect } from "vitest";
import {
  extractMakerRoster,
  extractWorkDistribution,
  type NotionWorkDistributionPage,
} from "../../src/lib/notion/work-distribution.schema.js";
import {
  extractPaySplit,
  sharesTotal,
  type NotionPaySplitPage,
} from "../../src/lib/notion/pay-splits.schema.js";

function page(
  properties: NotionWorkDistributionPage["properties"],
): NotionWorkDistributionPage {
  return { id: "work-1", properties };
}

describe("extractWorkDistribution", () => {
  it("reads the row the atelier actually keeps", () => {
    const record = extractWorkDistribution(
      page({
        "Production item": {
          type: "title",
          title: [{ plain_text: "Knight of Midnight Dress" }],
        },
        Product: { type: "rich_text", rich_text: [{ plain_text: "Adult M" }] },
        "Sale price": { type: "number", number: 500 },
        Units: { type: "number", number: 1 },
        Category: { type: "relation", relation: [{ id: "cat-dress" }] },
        Order: { type: "relation", relation: [{ id: "order-1" }] },
        "Order Stage": {
          type: "rollup",
          rollup: { type: "array", array: [{ status: { name: "Fitting" } }] },
        },
        "Consult & sketch by": {
          type: "select",
          select: { name: "Alexandra" },
        },
        "Sourcing materials by": { type: "select", select: { name: "Alayna" } },
        "Cutting & pinning fabric by": {
          type: "select",
          select: { name: "Alayna" },
        },
        "Sewing by": { type: "select", select: { name: "Alexandra" } },
        "Detailing by": { type: "select", select: { name: "Split" } },
        "Paid Alexandra": { type: "checkbox", checkbox: true },
        "Paid Alayna": { type: "checkbox", checkbox: false },
        Notes: { type: "rich_text", rich_text: [{ plain_text: "Rush job" }] },
      }),
    );

    expect(record).toEqual({
      id: "work-1",
      item: "Knight of Midnight Dress",
      product: "Adult M",
      salePrice: 500,
      units: 1,
      categoryId: "cat-dress",
      orderId: "order-1",
      orderStage: "Fitting",
      assignees: {
        consult: "Alexandra",
        sourcing: "Alayna",
        cutting: "Alayna",
        sewing: "Alexandra",
        detailing: "Split",
      },
      paid: { Alexandra: true, Alayna: false },
      notes: "Rush job",
    });
  });

  it("reads a blank Units as one piece, never as none", () => {
    // The row IS an item; folding a missing count to zero would value real
    // work at nothing, which is the one way this must not be wrong.
    const record = extractWorkDistribution(
      page({ "Sale price": { type: "number", number: 40 } }),
    );
    expect(record.units).toBe(1);
  });

  it("reads a missing sale price as unknown, not as zero", () => {
    const record = extractWorkDistribution(page({}));
    expect(record.salePrice).toBeNull();
  });

  it("finds settlement checkboxes by prefix, so the roster stays data", () => {
    const record = extractWorkDistribution(
      page({ "Paid Sam": { type: "checkbox", checkbox: true } }),
    );
    expect(record.paid).toEqual({ Sam: true });
  });

  it("ignores a non-checkbox property that happens to start with Paid", () => {
    const record = extractWorkDistribution(
      page({
        "Paid notes": { type: "rich_text", rich_text: [{ plain_text: "x" }] },
      }),
    );
    expect(record.paid).toEqual({});
  });

  it("reads a stage nobody is assigned to as blank", () => {
    const record = extractWorkDistribution(
      page({ "Sewing by": { type: "select", select: null } }),
    );
    expect(record.assignees.sewing).toBe("");
  });

  it("accepts an Order Stage rollup in either shape", () => {
    const bare = extractWorkDistribution(
      page({
        "Order Stage": {
          type: "rollup",
          rollup: { status: { name: "Delivered" } },
        },
      }),
    );
    expect(bare.orderStage).toBe("Delivered");
  });
});

describe("extractMakerRoster", () => {
  it("unions the makers across the five selects, dropping Split", () => {
    const roster = extractMakerRoster({
      "Consult & sketch by": {
        type: "select",
        select: { options: [{ name: "Alexandra" }, { name: "Split" }] },
      },
      "Sewing by": {
        type: "select",
        select: { options: [{ name: "Alayna" }, { name: "Alexandra" }] },
      },
    });

    expect(roster).toEqual(["Alayna", "Alexandra"]);
  });

  it("is empty when the schema carries no such selects", () => {
    expect(extractMakerRoster({})).toEqual([]);
  });
});

describe("extractPaySplit", () => {
  function splitPage(
    properties: NotionPaySplitPage["properties"],
  ): NotionPaySplitPage {
    return { id: "cat-1", properties };
  }

  it("reads the five shares as fractions of one", () => {
    const split = extractPaySplit(
      splitPage({
        Category: { type: "title", title: [{ plain_text: "Dress" }] },
        "Consult & sketch": { type: "number", number: 0.15 },
        Sourcing: { type: "number", number: 0.1 },
        "Cutting & pinning": { type: "number", number: 0.2 },
        Sewing: { type: "number", number: 0.35 },
        Detailing: { type: "number", number: 0.2 },
      }),
    );

    expect(split.category).toBe("Dress");
    expect(sharesTotal(split.shares)).toBeCloseTo(1);
  });

  it("reads a blank share as no share — the atelier leaves them empty", () => {
    const split = extractPaySplit(
      splitPage({
        Category: { type: "title", title: [{ plain_text: "Skate Soakers" }] },
        "Cutting & pinning": { type: "number", number: 0.3 },
        Sewing: { type: "number", number: 0.7 },
      }),
    );

    expect(split.shares.consult).toBe(0);
    expect(sharesTotal(split.shares)).toBeCloseTo(1);
  });

  it("floors a negative share, which would pay somebody backwards", () => {
    const split = extractPaySplit(
      splitPage({ Sewing: { type: "number", number: -0.5 } }),
    );
    expect(split.shares.sewing).toBe(0);
  });
});
