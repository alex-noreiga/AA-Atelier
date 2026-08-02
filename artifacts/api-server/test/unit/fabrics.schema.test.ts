import { describe, it, expect } from "vitest";
import { extractFabricRecords } from "../../src/lib/notion/fabrics.schema.js";

describe("extractFabricRecords", () => {
  it("maps a solid row to id, name, type, placement, hex, colorFamily, and sort", () => {
    expect(
      extractFabricRecords([
        {
          id: "f1",
          properties: {
            Name: { type: "title", title: [{ plain_text: "Ivory" }] },
            Type: { type: "select", select: { name: "Solid" } },
            Placement: { type: "select", select: { name: "Both" } },
            Hex: { type: "rich_text", rich_text: [{ plain_text: "#F4EFE6" }] },
            "Color Family": { type: "select", select: { name: "Neutrals" } },
            Sort: { type: "number", number: 1 },
          },
        },
      ]),
    ).toEqual([
      {
        id: "f1",
        name: "Ivory",
        type: "solid",
        placement: "both",
        hex: "#F4EFE6",
        colorFamily: "Neutrals",
        sort: 1,
      },
    ]);
  });

  it("omits colorFamily when the Color Family select is unset (a free label passed through verbatim)", () => {
    const [record] = extractFabricRecords([
      {
        id: "f9",
        properties: {
          Name: { type: "title", title: [{ plain_text: "Unfamilied" }] },
          Type: { type: "select", select: { name: "Solid" } },
          Placement: { type: "select", select: { name: "Bodice" } },
          "Color Family": { type: "select", select: { name: "Dusty Teal" } },
        },
      },
      {
        id: "f10",
        properties: {
          Name: { type: "title", title: [{ plain_text: "No family" }] },
          Type: { type: "select", select: { name: "Solid" } },
          Placement: { type: "select", select: { name: "Bodice" } },
        },
      },
    ]);
    // A free-label family is passed through verbatim, not mapped/validated.
    expect(record.colorFamily).toBe("Dusty Teal");
    // The second row has no family property.
    const second = extractFabricRecords([
      {
        id: "f10",
        properties: {
          Name: { type: "title", title: [{ plain_text: "No family" }] },
          Type: { type: "select", select: { name: "Solid" } },
          Placement: { type: "select", select: { name: "Bodice" } },
        },
      },
    ])[0];
    expect(second).not.toHaveProperty("colorFamily");
  });

  it("maps an image type to its first Swatch file URL, omitting hex", () => {
    const [record] = extractFabricRecords([
      {
        id: "f2",
        properties: {
          Name: { type: "title", title: [{ plain_text: "Floral" }] },
          Type: { type: "select", select: { name: "Print" } },
          Placement: { type: "select", select: { name: "Bodice" } },
          Swatch: {
            type: "files",
            files: [
              { type: "file", file: { url: "https://cdn/first.jpg" } },
              { type: "file", file: { url: "https://cdn/second.jpg" } },
            ],
          },
        },
      },
    ]);
    expect(record).toEqual({
      id: "f2",
      name: "Floral",
      type: "print",
      placement: "bodice",
      swatchImage: "https://cdn/first.jpg",
      sort: null,
    });
    expect(record).not.toHaveProperty("hex");
  });

  it("maps every fabric type + placement label to its contract enum value", () => {
    const rows = [
      ["Solid", "Bodice", "solid", "bodice"],
      ["Print", "Skirt", "print", "skirt"],
      ["Foil", "Both", "foil", "both"],
      ["Textured", "Bodice", "textured", "bodice"],
      ["Sequin", "Skirt", "sequin", "skirt"],
    ] as const;
    const records = extractFabricRecords(
      rows.map(([type, placement], i) => ({
        id: `f${i}`,
        properties: {
          Name: { type: "title", title: [{ plain_text: `Swatch ${i}` }] },
          Type: { type: "select", select: { name: type } },
          Placement: { type: "select", select: { name: placement } },
        },
      })),
    );
    expect(records.map((r) => [r.type, r.placement])).toEqual(
      rows.map(([, , t, p]) => [t, p]),
    );
  });

  it("drops rows with a blank name, an unknown type, or an unknown placement", () => {
    expect(
      extractFabricRecords([
        {
          id: "blank",
          properties: {
            Name: { type: "title", title: [] },
            Type: { type: "select", select: { name: "Solid" } },
            Placement: { type: "select", select: { name: "Both" } },
          },
        },
        {
          id: "bad-type",
          properties: {
            Name: { type: "title", title: [{ plain_text: "Mystery" }] },
            Type: { type: "select", select: { name: "Hologram" } },
            Placement: { type: "select", select: { name: "Both" } },
          },
        },
        {
          id: "no-placement",
          properties: {
            Name: { type: "title", title: [{ plain_text: "Homeless" }] },
            Type: { type: "select", select: { name: "Solid" } },
          },
        },
        {
          id: "ok",
          properties: {
            Name: { type: "title", title: [{ plain_text: "Black" }] },
            Type: { type: "select", select: { name: "Solid" } },
            Placement: { type: "select", select: { name: "Bodice" } },
          },
        },
      ]).map((r) => r.id),
    ).toEqual(["ok"]);
  });
});
