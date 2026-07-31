import { describe, it, expect } from "vitest";
import { toFabricList } from "../../src/services/fabrics.service.js";
import type { FabricRecord } from "../../src/lib/notion/fabrics.schema.js";

function record(overrides: Partial<FabricRecord> = {}): FabricRecord {
  return {
    id: "f1",
    name: "Ivory",
    type: "solid",
    placement: "both",
    sort: null,
    ...overrides,
  };
}

describe("toFabricList", () => {
  it("omits sort when unset (null) rather than emitting null", () => {
    const { fabrics } = toFabricList([record({ sort: null })]);
    expect(fabrics[0]).not.toHaveProperty("sort");
  });

  it("keeps hex / swatchImage when present", () => {
    const { fabrics } = toFabricList([
      record({ id: "s", hex: "#000000" }),
      record({ id: "p", type: "print", swatchImage: "https://cdn/p.jpg" }),
    ]);
    expect(fabrics.find((f) => f.id === "s")?.hex).toBe("#000000");
    expect(fabrics.find((f) => f.id === "p")?.swatchImage).toBe(
      "https://cdn/p.jpg",
    );
  });

  it("orders by sort ascending, unset last, then by name", () => {
    const { fabrics } = toFabricList([
      record({ id: "b", name: "Blush", sort: null }),
      record({ id: "a", name: "Amber", sort: null }),
      record({ id: "two", name: "Second", sort: 2 }),
      record({ id: "one", name: "First", sort: 1 }),
    ]);
    // Sorted rows first (1, 2), then the unsorted rows alphabetically.
    expect(fabrics.map((f) => f.id)).toEqual(["one", "two", "a", "b"]);
  });
});
