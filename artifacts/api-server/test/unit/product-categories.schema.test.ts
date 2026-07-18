import { describe, it, expect } from "vitest";
import { extractCategoryRecords } from "../../src/lib/notion/product-categories.schema.js";

describe("extractCategoryRecords", () => {
  it("maps each row to id, name, sized flag, size-guide type, and sort", () => {
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
            "Size guide type": {
              type: "select",
              select: { name: "Skate soaker" },
            },
            Sort: { type: "number", number: 4 },
          },
        },
      ]),
    ).toEqual([
      { id: "c1", name: "Dress", sized: true, sizeGuide: "garment", sort: 2 },
      {
        id: "c2",
        name: "Skate Soakers",
        sized: false,
        sizeGuide: "soaker",
        sort: 4,
      },
    ]);
  });

  it("defaults sizeGuide to garment when the select is unset or a garment value", () => {
    expect(
      extractCategoryRecords([
        {
          id: "c1",
          properties: {
            Name: { type: "title", title: [{ plain_text: "No select" }] },
          },
        },
        {
          id: "c2",
          properties: {
            Name: { type: "title", title: [{ plain_text: "Garment select" }] },
            "Size guide type": { type: "select", select: { name: "Garment" } },
          },
        },
      ]),
    ).toEqual([
      {
        id: "c1",
        name: "No select",
        sized: false,
        sizeGuide: "garment",
        sort: null,
      },
      {
        id: "c2",
        name: "Garment select",
        sized: false,
        sizeGuide: "garment",
        sort: null,
      },
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
    ).toEqual([
      {
        id: "c1",
        name: "Other",
        sized: false,
        sizeGuide: "garment",
        sort: null,
      },
    ]);
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
    ).toEqual([
      {
        id: "c2",
        name: "Dress",
        sized: true,
        sizeGuide: "garment",
        sort: null,
      },
    ]);
  });
});
