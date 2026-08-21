import { describe, it, expect } from "vitest";
import { classifyMaterials } from "../../src/services/materials.service.js";
import type { MaterialRecord } from "../../src/lib/notion/materials.schema.js";

function material(overrides: Partial<MaterialRecord> = {}): MaterialRecord {
  return {
    id: "mat-1",
    name: "Black Fleece",
    stockOnHand: 5,
    minimumStock: 1,
    alertsSuppressed: false,
    ...overrides,
  };
}

describe("classifyMaterials", () => {
  it("alerts on a material below its reorder point, with the shortfall", () => {
    const { lowStock } = classifyMaterials([
      material({ stockOnHand: 0.25, minimumStock: 0.5 }),
    ]);

    expect(lowStock).toHaveLength(1);
    expect(lowStock[0]).toMatchObject({
      name: "Black Fleece",
      stockOnHand: 0.25,
      minimumStock: 0.5,
      shortfall: 0.25,
    });
  });

  // A reorder point is the level you buy AT, not one you wait to fall under.
  it("alerts on a material sitting exactly on its reorder point", () => {
    const { lowStock } = classifyMaterials([
      material({ stockOnHand: 1, minimumStock: 1 }),
    ]);
    expect(lowStock).toHaveLength(1);
    expect(lowStock[0].shortfall).toBe(0);
  });

  it("leaves a material above its reorder point out of both lists", () => {
    const result = classifyMaterials([
      material({ stockOnHand: 5, minimumStock: 1 }),
    ]);
    expect(result.lowStock).toEqual([]);
    expect(result.untracked).toEqual([]);
    expect(result.totalCount).toBe(1);
  });

  it("ranks the worst shortfall first, breaking ties by name", () => {
    const { lowStock } = classifyMaterials([
      material({ id: "a", name: "Satin", stockOnHand: 4, minimumStock: 5 }),
      material({ id: "b", name: "Tulle", stockOnHand: 0, minimumStock: 10 }),
      material({ id: "c", name: "Batting", stockOnHand: 4, minimumStock: 5 }),
    ]);

    expect(lowStock.map((m) => m.name)).toEqual(["Tulle", "Batting", "Satin"]);
  });

  // Rounding: fractional yardages otherwise produce 0.7999999999999999.
  it("rounds the shortfall to two places", () => {
    const { lowStock } = classifyMaterials([
      material({ stockOnHand: 0.7, minimumStock: 1.5 }),
    ]);
    expect(lowStock[0].shortfall).toBe(0.8);
  });

  it("reports a material with no reorder point as untracked, keeping its stock", () => {
    const { lowStock, untracked } = classifyMaterials([
      material({ minimumStock: null, stockOnHand: 3 }),
    ]);

    expect(lowStock).toEqual([]);
    expect(untracked).toEqual([
      {
        id: "mat-1",
        name: "Black Fleece",
        reason: "no-reorder-point",
        stockOnHand: 3,
      },
    ]);
  });

  // Unknown stock is never an alert — absent is not zero.
  it("reports a material with unknown stock as untracked, never as an alert", () => {
    const { lowStock, untracked } = classifyMaterials([
      material({ stockOnHand: null, minimumStock: 2 }),
    ]);

    expect(lowStock).toEqual([]);
    expect(untracked[0]).toMatchObject({ reason: "stock-unknown" });
    expect(untracked[0]).not.toHaveProperty("stockOnHand");
  });

  // A muted material is the atelier saying "don't tell me" — silent, but counted.
  it("puts a suppressed material in neither list and counts it", () => {
    const result = classifyMaterials([
      material({ stockOnHand: 0, minimumStock: 5, alertsSuppressed: true }),
      material({
        id: "b",
        name: "Tulle",
        minimumStock: null,
        alertsSuppressed: true,
      }),
    ]);

    expect(result.lowStock).toEqual([]);
    expect(result.untracked).toEqual([]);
    expect(result.suppressedCount).toBe(2);
    expect(result.totalCount).toBe(2);
  });

  it("sorts the untracked list alphabetically", () => {
    const { untracked } = classifyMaterials([
      material({ id: "a", name: "Zip tape", minimumStock: null }),
      material({ id: "b", name: "Appliqué", minimumStock: null }),
    ]);
    expect(untracked.map((m) => m.name)).toEqual(["Appliqué", "Zip tape"]);
  });

  it("handles an empty database", () => {
    expect(classifyMaterials([])).toEqual({
      lowStock: [],
      untracked: [],
      suppressedCount: 0,
      totalCount: 0,
    });
  });
});
