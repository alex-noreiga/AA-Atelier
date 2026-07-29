import { describe, it, expect } from "vitest";
import type { InvoiceLineItem } from "@workspace/api-client-react";
import { groupLineItems } from "@/lib/invoice-format";

const line = (name: string, type: string, amount = 10): InvoiceLineItem => ({
  name,
  type,
  amount,
});

describe("groupLineItems", () => {
  it("orders groups Garment → Material → Labor → Adjustment", () => {
    const groups = groupLineItems([
      line("Design & finishing", "Adjustment"),
      line("Construction", "Labor"),
      line("Main fabric", "Material"),
      line("Base garment", "Garment"),
    ]);

    expect(groups.map((g) => g.type)).toEqual([
      "Garment",
      "Material",
      "Labor",
      "Adjustment",
    ]);
  });

  it("maps each known type to its display heading", () => {
    const groups = groupLineItems([line("Rhinestones", "Material")]);
    expect(groups[0].heading).toBe("Materials");
  });

  it("preserves item order within a group", () => {
    const groups = groupLineItems([
      line("Main fabric", "Material"),
      line("Lining", "Material"),
      line("Rhinestones", "Material"),
    ]);
    expect(groups[0].items.map((i) => i.name)).toEqual([
      "Main fabric",
      "Lining",
      "Rhinestones",
    ]);
  });

  it("keeps an unknown type under its raw name, after the known ones", () => {
    const groups = groupLineItems([
      line("Gift discount", "Discount"),
      line("Main fabric", "Material"),
    ]);
    expect(groups.map((g) => g.type)).toEqual(["Material", "Discount"]);
    expect(groups[1].heading).toBe("Discount");
  });

  it("orders a Surcharge line last, after the other known types", () => {
    const groups = groupLineItems([
      line("Rush surcharge", "Surcharge"),
      line("Construction", "Labor"),
      line("Main fabric", "Material"),
    ]);
    expect(groups.map((g) => g.type)).toEqual([
      "Material",
      "Labor",
      "Surcharge",
    ]);
    expect(groups[2].heading).toBe("Surcharge");
  });

  it("returns nothing for an empty list", () => {
    expect(groupLineItems([])).toEqual([]);
  });
});
