import { describe, it, expect } from "vitest";
import {
  extractStageOptions,
  extractOrderNumber,
  extractOrderName,
  extractCurrentStage,
  extractInvoiceRelationId,
  extractDueDate,
  extractMilestonesGenerated,
  extractCancelled,
  extractFulfilmentFields,
  extractMeasurements,
  type NotionDatabaseSchema,
  type NotionOrderPage,
} from "../../src/lib/notion/orders.schema.js";

describe("extractStageOptions", () => {
  it("reads the live 'Stage' status option names in order", () => {
    const schema: NotionDatabaseSchema = {
      properties: {
        Stage: {
          type: "status",
          status: {
            options: [
              { id: "1", name: "Consultation" },
              { id: "2", name: "Sketching" },
              { id: "3", name: "Delivery" },
            ],
          },
        },
      },
    };
    expect(extractStageOptions(schema)).toEqual([
      "Consultation",
      "Sketching",
      "Delivery",
    ]);
  });

  it("returns [] when the Stage property is absent", () => {
    const schema: NotionDatabaseSchema = { properties: {} };
    expect(extractStageOptions(schema)).toEqual([]);
  });

  it("returns [] when the Stage property has no status options", () => {
    const schema: NotionDatabaseSchema = {
      properties: { Stage: { type: "status" } },
    };
    expect(extractStageOptions(schema)).toEqual([]);
  });
});

describe("extractOrderName", () => {
  it("joins multi-chunk title arrays into a single string", () => {
    const page: NotionOrderPage = {
      id: "p",
      properties: {
        "Order Name": {
          type: "title",
          title: [{ plain_text: "Ada " }, { plain_text: "Lovelace" }],
        },
      },
    };
    expect(extractOrderName(page)).toBe("Ada Lovelace");
  });

  it("returns '' when the title is empty or the property is missing", () => {
    expect(
      extractOrderName({ id: "p", properties: {} } as NotionOrderPage),
    ).toBe("");
    expect(
      extractOrderName({
        id: "p",
        properties: { "Order Name": { type: "title", title: [] } },
      }),
    ).toBe("");
  });
});

describe("extractCurrentStage", () => {
  it("returns the status name when set", () => {
    const page: NotionOrderPage = {
      id: "p",
      properties: { Stage: { type: "status", status: { name: "Sewing" } } },
    };
    expect(extractCurrentStage(page)).toBe("Sewing");
  });

  it("returns '' when the status is null (a stage was never set)", () => {
    const page: NotionOrderPage = {
      id: "p",
      properties: { Stage: { type: "status", status: null } },
    };
    expect(extractCurrentStage(page)).toBe("");
  });

  it("returns '' when the Stage property is missing entirely", () => {
    expect(
      extractCurrentStage({ id: "p", properties: {} } as NotionOrderPage),
    ).toBe("");
  });
});

describe("extractOrderNumber", () => {
  it("joins the rich_text chunks of the Order Number", () => {
    const page: NotionOrderPage = {
      id: "p",
      properties: {
        "Order Number": {
          type: "rich_text",
          rich_text: [{ plain_text: "ORD-" }, { plain_text: "ABC" }],
        },
      },
    };
    expect(extractOrderNumber(page)).toBe("ORD-ABC");
  });

  it("returns '' when the property is empty or missing", () => {
    expect(
      extractOrderNumber({
        id: "p",
        properties: { "Order Number": { type: "rich_text", rich_text: [] } },
      }),
    ).toBe("");
    expect(
      extractOrderNumber({ id: "p", properties: {} } as NotionOrderPage),
    ).toBe("");
  });
});

describe("extractDueDate", () => {
  it("returns the date start when set", () => {
    const page: NotionOrderPage = {
      id: "p",
      properties: {
        "Due Date": {
          type: "date",
          date: { start: "2026-09-01", end: null },
        },
      },
    };
    expect(extractDueDate(page)).toBe("2026-09-01");
  });

  it("returns undefined when the date is null or the property is missing", () => {
    expect(
      extractDueDate({
        id: "p",
        properties: { "Due Date": { type: "date", date: null } },
      }),
    ).toBeUndefined();
    expect(
      extractDueDate({ id: "p", properties: {} } as NotionOrderPage),
    ).toBeUndefined();
  });
});

describe("extractMilestonesGenerated", () => {
  it("reflects the checkbox, defaulting to false when the property is missing", () => {
    expect(
      extractMilestonesGenerated({
        id: "p",
        properties: {
          "Milestones Generated": { type: "checkbox", checkbox: true },
        },
      }),
    ).toBe(true);
    expect(
      extractMilestonesGenerated({
        id: "p",
        properties: {},
      } as NotionOrderPage),
    ).toBe(false);
  });
});

describe("extractCancelled", () => {
  it("reflects the checkbox, defaulting to false when the property is missing", () => {
    expect(
      extractCancelled({
        id: "p",
        properties: { Cancelled: { type: "checkbox", checkbox: true } },
      }),
    ).toBe(true);
    expect(
      extractCancelled({ id: "p", properties: {} } as NotionOrderPage),
    ).toBe(false);
  });
});

describe("extractFulfilmentFields", () => {
  it("reads the shipping and collection columns verbatim", () => {
    // Verbatim on purpose — deciding what any of it means is `lib/fulfilment.ts`'s
    // job, so both order kinds go through one set of rules.
    expect(
      extractFulfilmentFields({
        id: "p",
        properties: {
          "Delivery Method": {
            type: "select",
            select: { name: "Local pickup" },
          },
          Fulfilment: { type: "select", select: { name: "Packed" } },
          "Tracking Number": {
            type: "rich_text",
            rich_text: [{ plain_text: "9400111899" }],
          },
          Carrier: { type: "rich_text", rich_text: [{ plain_text: "USPS" }] },
          "Tracking URL": { type: "url", url: "https://tools.usps.com/track" },
          "Ship By": {
            type: "date",
            date: { start: "2026-09-01", end: null },
          },
          "Pickup Time": {
            type: "date",
            date: { start: "2026-09-03T14:00:00.000-05:00", end: null },
          },
          "Pickup Location": {
            type: "rich_text",
            rich_text: [{ plain_text: "The studio" }],
          },
        },
      }),
    ).toEqual({
      method: "Local pickup",
      state: "Packed",
      trackingNumber: "9400111899",
      carrier: "USPS",
      trackingUrl: "https://tools.usps.com/track",
      shipBy: "2026-09-01",
      pickupAt: "2026-09-03T14:00:00.000-05:00",
      pickupLocation: "The studio",
    });
  });

  it("returns an empty object when the workspace hasn't added the properties", () => {
    // Reading a property Notion doesn't have is simply absent from the payload,
    // so an order tracks exactly as it did before pickup existed.
    expect(
      extractFulfilmentFields({ id: "p", properties: {} } as NotionOrderPage),
    ).toEqual({});
  });

  it("treats blank values as unset", () => {
    expect(
      extractFulfilmentFields({
        id: "p",
        properties: {
          "Delivery Method": { type: "select", select: null },
          "Tracking Number": { type: "rich_text", rich_text: [] },
          "Pickup Location": {
            type: "rich_text",
            rich_text: [{ plain_text: "   " }],
          },
          "Tracking URL": { type: "url", url: null },
          "Ship By": { type: "date", date: null },
        },
      }),
    ).toEqual({});
  });
});

describe("extractInvoiceRelationId", () => {
  it("returns the first related invoice page id", () => {
    expect(
      extractInvoiceRelationId({
        id: "p",
        properties: {
          Invoices: { type: "relation", relation: [{ id: "inv-7" }] },
        },
      }),
    ).toBe("inv-7");
  });

  it("returns undefined when the relation is empty or missing", () => {
    expect(
      extractInvoiceRelationId({
        id: "p",
        properties: { Invoices: { type: "relation", relation: [] } },
      }),
    ).toBeUndefined();
    expect(
      extractInvoiceRelationId({ id: "p", properties: {} } as NotionOrderPage),
    ).toBeUndefined();
  });
});

describe("extractMeasurements", () => {
  it("reads the five values + unit off the order properties (Chest → bust)", () => {
    const page: NotionOrderPage = {
      id: "p",
      properties: {
        Waist: { type: "number", number: 28 },
        Chest: { type: "number", number: 36 },
        Hips: { type: "number", number: 38 },
        Height: { type: "number", number: 65 },
        "Body Girth": { type: "number", number: 32 },
        "Measurement Unit": { type: "select", select: { name: "cm" } },
      },
    };
    expect(extractMeasurements(page)).toEqual({
      unit: "cm",
      waist: 28,
      bust: 36,
      hips: 38,
      height: 65,
      bodyGirth: 32,
    });
  });

  it("returns undefined when no measurement value is set (measure-at-fitting / legacy)", () => {
    expect(extractMeasurements({ id: "p", properties: {} })).toBeUndefined();
  });

  it("returns the present values (unit defaults to inches) for a partial order", () => {
    const page: NotionOrderPage = {
      id: "p",
      properties: {
        Waist: { type: "number", number: 28 },
        Chest: { type: "number", number: null },
      },
    };
    expect(extractMeasurements(page)).toEqual({ unit: "inches", waist: 28 });
  });
});
