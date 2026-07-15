import { describe, it, expect } from "vitest";
import {
  extractStageOptions,
  extractOrderNumber,
  extractOrderName,
  extractCurrentStage,
  extractDepositAmount,
  extractDepositPaid,
  extractDueDate,
  extractMilestonesGenerated,
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

describe("extractDepositAmount", () => {
  it("returns the number when set", () => {
    const page: NotionOrderPage = {
      id: "p",
      properties: { "Deposit Amount": { type: "number", number: 150 } },
    };
    expect(extractDepositAmount(page)).toBe(150);
  });

  it("returns undefined when unset (null) or the property is missing", () => {
    expect(
      extractDepositAmount({
        id: "p",
        properties: { "Deposit Amount": { type: "number", number: null } },
      }),
    ).toBeUndefined();
    expect(
      extractDepositAmount({ id: "p", properties: {} } as NotionOrderPage),
    ).toBeUndefined();
  });
});

describe("extractDepositPaid", () => {
  it("reflects the checkbox, defaulting to false when the property is missing", () => {
    expect(
      extractDepositPaid({
        id: "p",
        properties: { "Deposit Paid": { type: "checkbox", checkbox: true } },
      }),
    ).toBe(true);
    expect(
      extractDepositPaid({ id: "p", properties: {} } as NotionOrderPage),
    ).toBe(false);
  });
});
