import { describe, it, expect } from "vitest";
import {
  extractStageOptions,
  extractOrderName,
  extractCurrentStage,
  type NotionDatabaseSchema,
  type NotionOrderPage,
} from "../../src/lib/notion/schema.js";

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
