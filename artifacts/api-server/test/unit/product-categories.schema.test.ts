import { describe, it, expect } from "vitest";
import { extractCategoryRecords } from "../../src/lib/notion/product-categories.schema.js";

describe("extractCategoryRecords", () => {
  it("maps each row to id, name, sized flag, and sort", () => {
    expect(
      extractCategoryRecords([
        {
          id: "c1",
          properties: {
            Name: { type: "title", title: [{ plain_text: "Dress" }] },
            "Show size guide": { type: "checkbox", checkbox: true },
            Sort: { type: "number", number: 2 },
          },
        },
        {
          id: "c2",
          properties: {
            Name: { type: "title", title: [{ plain_text: "Skate Soakers" }] },
            "Show size guide": { type: "checkbox", checkbox: false },
            Sort: { type: "number", number: 4 },
          },
        },
      ]),
    ).toEqual([
      { id: "c1", name: "Dress", sized: true, sort: 2 },
      { id: "c2", name: "Skate Soakers", sized: false, sort: 4 },
    ]);
  });

  it("defaults sized to false and sort to null when the properties are absent", () => {
    expect(
      extractCategoryRecords([
        {
          id: "c1",
          properties: {
            Name: { type: "title", title: [{ plain_text: "Other" }] },
          },
        },
      ]),
    ).toEqual([{ id: "c1", name: "Other", sized: false, sort: null }]);
  });

  it("drops a row whose name is empty", () => {
    expect(
      extractCategoryRecords([
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
    ).toEqual([{ id: "c2", name: "Dress", sized: true, sort: null }]);
  });
});
