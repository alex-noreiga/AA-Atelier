// How the materials panel is grouped. Pure, so the rules are pinned without
// rendering anything — and the rules are the interesting part: a shopping list
// that repeats a material is a way to buy it twice.

import { describe, it, expect } from "vitest";
import {
  groupMaterials,
  UNCATEGORIZED_LABEL,
  UNTYPED_LABEL,
} from "@/lib/material-groups";

interface Row {
  id: string;
  category?: string;
  fabricTypes?: string[];
  shortfall: number;
}

const row = (id: string, extra: Partial<Row> = {}): Row => ({
  id,
  shortfall: 0,
  ...extra,
});

const labels = <T>(groups: Array<{ label: string; items: T[] }>) =>
  groups.map((group) => group.label);

const ids = (items: Array<{ id: string }>) => items.map((item) => item.id);

describe("groupMaterials — by category", () => {
  it("buckets rows under their category", () => {
    const groups = groupMaterials([
      row("a", { category: "Fabric" }),
      row("b", { category: "Packaging" }),
      row("c", { category: "Fabric" }),
    ]);

    expect(labels(groups).sort()).toEqual(["Fabric", "Packaging"]);
    expect(ids(groups.find((g) => g.label === "Fabric")!.items)).toEqual([
      "a",
      "c",
    ]);
  });

  it("leads with the category holding the worst shortfall", () => {
    // The panel's premise is "buy this first", so the ranking survives the
    // grouping rather than being replaced by an alphabetical list.
    const groups = groupMaterials(
      [
        row("box", { category: "Packaging", shortfall: 2 }),
        row("satin", { category: "Fabric", shortfall: 9 }),
        row("bead", { category: "Crystal", shortfall: 5 }),
      ],
      (item) => item.shortfall,
    );

    expect(labels(groups)).toEqual(["Fabric", "Crystal", "Packaging"]);
  });

  it("orders alphabetically when nothing ranks the rows", () => {
    const groups = groupMaterials([
      row("a", { category: "Packaging" }),
      row("b", { category: "Crystal" }),
      row("c", { category: "Applique" }),
    ]);

    expect(labels(groups)).toEqual(["Applique", "Crystal", "Packaging"]);
  });

  it("files an uncategorized row under a catch-all, and puts it LAST", () => {
    // Even when it holds the worst shortfall: "we don't know what this is" is
    // not something to lead a shopping list with.
    const groups = groupMaterials(
      [
        row("mystery", { shortfall: 99 }),
        row("satin", { category: "Fabric", shortfall: 1 }),
      ],
      (item) => item.shortfall,
    );

    expect(labels(groups)).toEqual(["Fabric", UNCATEGORIZED_LABEL]);
  });

  it("keeps the order the rows arrived in within a group", () => {
    // The server already sorted; re-sorting here would be a second opinion.
    const groups = groupMaterials([
      row("second", { category: "Fabric" }),
      row("first", { category: "Fabric" }),
    ]);

    expect(ids(groups[0].items)).toEqual(["second", "first"]);
  });
});

describe("groupMaterials — fabric by type", () => {
  it("sub-groups a category whose rows carry fabric types", () => {
    const groups = groupMaterials([
      row("mesh", { category: "Fabric", fabricTypes: ["Power Mesh"] }),
      row("satin", { category: "Fabric", fabricTypes: ["Satin"] }),
      row("mesh2", { category: "Fabric", fabricTypes: ["Power Mesh"] }),
    ]);

    const fabric = groups.find((group) => group.label === "Fabric")!;
    expect(labels(fabric.subGroups!)).toEqual(["Power Mesh", "Satin"]);
    expect(ids(fabric.subGroups![0].items)).toEqual(["mesh", "mesh2"]);
  });

  it("leaves a category with no types un-sub-grouped", () => {
    const groups = groupMaterials([row("box", { category: "Packaging" })]);
    expect(groups[0].subGroups).toBeUndefined();
  });

  it("files a multi-typed material under its FIRST type, exactly once", () => {
    // The load-bearing one. Notion's own grouped view would show this row under
    // both, which on a shopping list is how you buy the same fabric twice.
    const groups = groupMaterials([
      row("mesh", {
        category: "Fabric",
        fabricTypes: ["Power Mesh", "Lining"],
      }),
    ]);

    const fabric = groups[0];
    expect(labels(fabric.subGroups!)).toEqual(["Power Mesh"]);
    expect(fabric.items).toHaveLength(1);
    expect(fabric.subGroups!.reduce((n, sub) => n + sub.items.length, 0)).toBe(
      1,
    );
  });

  it("puts an untyped fabric under a catch-all sub-heading, last", () => {
    const groups = groupMaterials(
      [
        row("plain", { category: "Fabric", shortfall: 9 }),
        row("satin", {
          category: "Fabric",
          fabricTypes: ["Satin"],
          shortfall: 1,
        }),
      ],
      (item) => item.shortfall,
    );

    expect(labels(groups[0].subGroups!)).toEqual(["Satin", UNTYPED_LABEL]);
  });

  it("ranks sub-groups by their worst shortfall too", () => {
    const groups = groupMaterials(
      [
        row("satin", {
          category: "Fabric",
          fabricTypes: ["Satin"],
          shortfall: 2,
        }),
        row("mesh", {
          category: "Fabric",
          fabricTypes: ["Power Mesh"],
          shortfall: 8,
        }),
      ],
      (item) => item.shortfall,
    );

    expect(labels(groups[0].subGroups!)).toEqual(["Power Mesh", "Satin"]);
  });

  it("every item in a sub-grouped category appears in exactly one sub-group", () => {
    const rows = [
      row("a", { category: "Fabric", fabricTypes: ["Satin"] }),
      row("b", { category: "Fabric", fabricTypes: ["Lining", "Satin"] }),
      row("c", { category: "Fabric" }),
    ];
    const fabric = groupMaterials(rows)[0];

    const seen = fabric.subGroups!.flatMap((sub) => ids(sub.items));
    expect(seen.sort()).toEqual(["a", "b", "c"]);
    expect(new Set(seen).size).toBe(seen.length);
  });
});
