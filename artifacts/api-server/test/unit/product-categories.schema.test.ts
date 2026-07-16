import { describe, it, expect } from "vitest";
import { extractSizedCategoryNames } from "../../src/lib/notion/product-categories.schema.js";

describe("extractSizedCategoryNames", () => {
  it("returns the names of categories whose Show size guide is ticked", () => {
    expect(
      extractSizedCategoryNames([
        {
          id: "c1",
          properties: {
            Name: { type: "title", title: [{ plain_text: "Dress" }] },
            "Show size guide": { type: "checkbox", checkbox: true },
          },
        },
        {
          id: "c2",
          properties: {
            Name: { type: "title", title: [{ plain_text: "Skate Soakers" }] },
            "Show size guide": { type: "checkbox", checkbox: false },
          },
        },
        {
          id: "c3",
          properties: {
            Name: { type: "title", title: [{ plain_text: "Ready to Wear" }] },
            "Show size guide": { type: "checkbox", checkbox: true },
          },
        },
      ]),
    ).toEqual(["Dress", "Ready to Wear"]);
  });

  it("drops a ticked row whose name is empty", () => {
    expect(
      extractSizedCategoryNames([
        {
          id: "c1",
          properties: {
            Name: { type: "title", title: [] },
            "Show size guide": { type: "checkbox", checkbox: true },
          },
        },
        {
          id: "c2",
          properties: {
            Name: { type: "title", title: [{ plain_text: "Dress" }] },
            "Show size guide": { type: "checkbox", checkbox: true },
          },
        },
      ]),
    ).toEqual(["Dress"]);
  });

  it("returns [] when no category is ticked", () => {
    expect(
      extractSizedCategoryNames([
        {
          id: "c1",
          properties: {
            Name: { type: "title", title: [{ plain_text: "Dress" }] },
            "Show size guide": { type: "checkbox", checkbox: false },
          },
        },
      ]),
    ).toEqual([]);
  });
});
