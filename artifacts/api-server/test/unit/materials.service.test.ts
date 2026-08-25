import { describe, it, expect } from "vitest";
import {
  classifyMaterials,
  canBeRepurchased,
} from "../../src/services/materials.service.js";
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
      notRestockable: [],
      untracked: [],
      suppressedCount: 0,
      totalCount: 0,
    });
  });

  // The dashboard groups fabric by type, so both projections have to carry it —
  // an alert AND an unwatched row, since the unwatched list is grouped too.
  it("carries the fabric types onto both the alert and the unwatched row", () => {
    const { lowStock, untracked } = classifyMaterials([
      material({
        id: "low",
        stockOnHand: 0,
        minimumStock: 2,
        fabricTypes: ["Power Mesh", "Lining"],
      }),
      material({
        id: "unwatched",
        minimumStock: null,
        stockOnHand: 3,
        fabricTypes: ["Satin"],
      }),
    ]);

    expect(lowStock[0].fabricTypes).toEqual(["Power Mesh", "Lining"]);
    expect(untracked[0].fabricTypes).toEqual(["Satin"]);
  });

  it("omits fabric types on a material that carries none", () => {
    const { lowStock } = classifyMaterials([
      material({ stockOnHand: 0, minimumStock: 2 }),
    ]);
    expect(lowStock[0].fabricTypes).toBeUndefined();
  });
  // A deadstock lot or a discontinued line has no vendor to send anyone to, so
  // it is not something to reorder — but it is not nothing either: running one
  // down is when a substitute has to be picked.
  it("keeps a material that can't be bought again out of the reorder list", () => {
    const { lowStock, notRestockable } = classifyMaterials([
      material({
        id: "dead",
        name: "Black Rhinestone Velvet",
        stockOnHand: 0,
        minimumStock: 2,
        reorderStatus: "Deadstock",
      }),
      material({
        id: "live",
        name: "Power Mesh",
        stockOnHand: 1,
        minimumStock: 4,
        reorderStatus: "Restockable",
      }),
    ]);

    expect(lowStock.map((m) => m.id)).toEqual(["live"]);
    expect(notRestockable.map((m) => m.id)).toEqual(["dead"]);
    expect(notRestockable[0].reorderStatus).toBe("Deadstock");
  });

  it("keeps an UNCLASSIFIED material on the reorder list", () => {
    // The load-bearing direction. 38 of the atelier's 50 rows carry no Reorder
    // Status, including 9 they've set a reorder point on — an allowlist of
    // "Restockable" would drop those 9 without saying anything.
    const { lowStock, notRestockable } = classifyMaterials([
      material({ id: "unset", stockOnHand: 0, minimumStock: 2 }),
      material({
        id: "unchecked",
        stockOnHand: 0,
        minimumStock: 2,
        reorderStatus: "Unchecked",
      }),
    ]);

    expect(lowStock.map((m) => m.id).sort()).toEqual(["unchecked", "unset"]);
    expect(notRestockable).toEqual([]);
  });

  it("keeps a made-to-order material on the reorder list, with its status", () => {
    // A custom print or dye run is still orderable — it just takes longer.
    const { lowStock, notRestockable } = classifyMaterials([
      material({
        id: "custom",
        stockOnHand: 0,
        minimumStock: 2,
        reorderStatus: "Made to order",
      }),
    ]);

    expect(lowStock.map((m) => m.id)).toEqual(["custom"]);
    expect(lowStock[0].reorderStatus).toBe("Made to order");
    expect(notRestockable).toEqual([]);
  });

  it("only withholds a material that is actually LOW", () => {
    // Deadstock with stock above its reorder point is simply fine, and a
    // deadstock row with no reorder point stays in the unwatched list rather
    // than being reported as something that can't be reordered.
    const { lowStock, notRestockable, untracked } = classifyMaterials([
      material({
        id: "ok",
        stockOnHand: 9,
        minimumStock: 2,
        reorderStatus: "Deadstock",
      }),
      material({
        id: "nopoint",
        minimumStock: null,
        stockOnHand: 0,
        reorderStatus: "Deadstock",
      }),
    ]);

    expect(lowStock).toEqual([]);
    expect(notRestockable).toEqual([]);
    expect(untracked.map((m) => m.id)).toEqual(["nopoint"]);
  });

  it("ranks the not-restockable list worst-first too", () => {
    const { notRestockable } = classifyMaterials([
      material({
        id: "a",
        name: "A",
        stockOnHand: 1,
        minimumStock: 2,
        reorderStatus: "Discontinued",
      }),
      material({
        id: "b",
        name: "B",
        stockOnHand: 0,
        minimumStock: 9,
        reorderStatus: "Deadstock",
      }),
    ]);

    expect(notRestockable.map((m) => m.id)).toEqual(["b", "a"]);
  });
});

describe("canBeRepurchased", () => {
  it("says no only to what positively can't be bought again", () => {
    expect(canBeRepurchased("Deadstock")).toBe(false);
    expect(canBeRepurchased("Discontinued")).toBe(false);
  });

  it("says yes to everything else, including unset and unrecognized", () => {
    // A denylist, not an allowlist: unset is the majority case, and an option
    // the atelier invents must not silently remove a material from the list.
    expect(canBeRepurchased(undefined)).toBe(true);
    expect(canBeRepurchased("")).toBe(true);
    expect(canBeRepurchased("Restockable")).toBe(true);
    expect(canBeRepurchased("Unchecked")).toBe(true);
    expect(canBeRepurchased("Made to order")).toBe(true);
    expect(canBeRepurchased("Seasonal")).toBe(true);
  });

  it("ignores casing and stray spacing, as a hand-typed option can carry", () => {
    expect(canBeRepurchased("  deadstock ")).toBe(false);
  });
});
