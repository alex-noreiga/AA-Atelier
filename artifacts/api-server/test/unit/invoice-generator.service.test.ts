import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Notion repositories so the generator's orchestration runs without
// network. Each test drives the reads and asserts on the writes.
vi.mock("../../src/lib/notion/orders.repository.js", () => ({
  findOrderByNumber: vi.fn(),
}));
vi.mock("../../src/lib/notion/invoice.repository.js", () => ({
  listInvoiceLineItems: vi.fn(),
  createInvoiceLineItem: vi.fn(),
  setInvoiceTitle: vi.fn(),
}));
vi.mock("../../src/lib/notion/costing.repository.js", () => ({
  getCostingItem: vi.fn(),
  getMaterialUsageLine: vi.fn(),
}));

import { generateInvoiceLineItems } from "../../src/services/invoice-generator.service.js";
import { findOrderByNumber } from "../../src/lib/notion/orders.repository.js";
import {
  listInvoiceLineItems,
  createInvoiceLineItem,
  setInvoiceTitle,
} from "../../src/lib/notion/invoice.repository.js";
import {
  getCostingItem,
  getMaterialUsageLine,
} from "../../src/lib/notion/costing.repository.js";
import type { OrderRecord } from "../../src/lib/notion/orders.schema.js";

const mockFindOrder = vi.mocked(findOrderByNumber);
const mockListLines = vi.mocked(listInvoiceLineItems);
const mockCreateLine = vi.mocked(createInvoiceLineItem);
const mockSetTitle = vi.mocked(setInvoiceTitle);
const mockGetCosting = vi.mocked(getCostingItem);
const mockGetUsage = vi.mocked(getMaterialUsageLine);

function order(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    orderNumber: "ORD-1",
    orderName: "Toothless Dress",
    currentStage: "Sewing/Construction",
    stages: [],
    pageId: "order-1",
    invoicePageId: "invoice-1",
    costingItemIds: ["costing-1"],
    ...overrides,
  };
}

// Look up a created line by its Line Type, so assertions don't depend on order.
function lineOfType(type: string) {
  const call = mockCreateLine.mock.calls.find((c) => c[0].lineType === type);
  return call?.[0];
}

describe("generateInvoiceLineItems", () => {
  beforeEach(() => {
    mockListLines.mockResolvedValue([]);
    mockSetTitle.mockResolvedValue(undefined);
    mockCreateLine.mockResolvedValue(undefined);
  });

  it("itemizes materials + labor + a reconciling margin line landing on Suggested Price", async () => {
    mockFindOrder.mockResolvedValue(order());
    mockGetCosting.mockResolvedValue({
      pageId: "costing-1",
      laborCost: 40,
      suggestedPrice: 140,
      usageLineIds: ["u1", "u2"],
    });
    mockGetUsage.mockImplementation(async (id) =>
      id === "u1"
        ? {
            pageId: "u1",
            name: "Red chiffon",
            materialCost: 30,
            usageType: "Material",
          }
        : {
            pageId: "u2",
            name: "Lining",
            materialCost: 30,
            usageType: "Material",
          },
    );

    const result = await generateInvoiceLineItems("ORD-1");

    // Names the invoice after the order number.
    expect(mockSetTitle).toHaveBeenCalledWith("invoice-1", "ORD-1");

    // Two material lines, priced at cost, linked to their usage line, NOT the costing item.
    const materialCalls = mockCreateLine.mock.calls.filter(
      (c) => c[0].lineType === "Material",
    );
    expect(materialCalls).toHaveLength(2);
    expect(materialCalls[0][0]).toMatchObject({
      invoicePageId: "invoice-1",
      orderPageId: "order-1",
      name: "Red chiffon",
      unitPrice: 30,
      materialUsageLineId: "u1",
    });

    // One labor line at the summed labor cost.
    expect(lineOfType("Labor")).toMatchObject({ name: "Labor", unitPrice: 40 });

    // Reconciling adjustment = 140 − (60 + 40) = 40, folding in the margin.
    expect(lineOfType("Adjustment")).toMatchObject({
      name: "Design & finishing",
      unitPrice: 40,
    });

    expect(result).toEqual({
      orderNumber: "ORD-1",
      alreadyPresent: false,
      materialLinesCreated: 2,
      laborLineCreated: true,
      adjustmentLineCreated: true,
      invoiceTotal: 140,
    });
  });

  it("skips packaging usage lines", async () => {
    mockFindOrder.mockResolvedValue(order());
    mockGetCosting.mockResolvedValue({
      pageId: "costing-1",
      laborCost: 0,
      suggestedPrice: 30,
      usageLineIds: ["u1", "pkg"],
    });
    mockGetUsage.mockImplementation(async (id) =>
      id === "u1"
        ? {
            pageId: "u1",
            name: "Fabric",
            materialCost: 30,
            usageType: "Material",
          }
        : {
            pageId: "pkg",
            name: "Box",
            materialCost: 5,
            usageType: "Packaging",
          },
    );

    const result = await generateInvoiceLineItems("ORD-1");

    expect(result.materialLinesCreated).toBe(1);
    expect(mockCreateLine.mock.calls.some((c) => c[0].name === "Box")).toBe(
      false,
    );
  });

  it("aggregates labor + suggested price across multiple costing items into one labor line", async () => {
    mockFindOrder.mockResolvedValue(
      order({ costingItemIds: ["costing-1", "costing-2"] }),
    );
    mockGetCosting.mockImplementation(async (id) =>
      id === "costing-1"
        ? {
            pageId: "costing-1",
            laborCost: 40,
            suggestedPrice: 100,
            usageLineIds: ["u1"],
          }
        : {
            pageId: "costing-2",
            laborCost: 20,
            suggestedPrice: 60,
            usageLineIds: ["u2"],
          },
    );
    mockGetUsage.mockImplementation(async (id) => ({
      pageId: id,
      name: `Material ${id}`,
      materialCost: 25,
      usageType: "Material",
    }));

    const result = await generateInvoiceLineItems("ORD-1");

    // One labor line summing both costing items (40 + 20).
    const laborCalls = mockCreateLine.mock.calls.filter(
      (c) => c[0].lineType === "Labor",
    );
    expect(laborCalls).toHaveLength(1);
    expect(laborCalls[0][0].unitPrice).toBe(60);
    // Adjustment = 160 suggested − (50 materials + 60 labor) = 50.
    expect(lineOfType("Adjustment")?.unitPrice).toBe(50);
    expect(result.invoiceTotal).toBe(160);
  });

  it("omits the labor line when there is no labor cost", async () => {
    mockFindOrder.mockResolvedValue(order());
    mockGetCosting.mockResolvedValue({
      pageId: "costing-1",
      laborCost: 0,
      suggestedPrice: 40,
      usageLineIds: ["u1"],
    });
    mockGetUsage.mockResolvedValue({
      pageId: "u1",
      name: "Fabric",
      materialCost: 30,
      usageType: "Material",
    });

    const result = await generateInvoiceLineItems("ORD-1");

    expect(result.laborLineCreated).toBe(false);
    expect(lineOfType("Labor")).toBeUndefined();
    // Adjustment = 40 − 30 = 10.
    expect(lineOfType("Adjustment")?.unitPrice).toBe(10);
  });

  it("omits the reconciling line when materials + labor already equal Suggested Price", async () => {
    mockFindOrder.mockResolvedValue(order());
    mockGetCosting.mockResolvedValue({
      pageId: "costing-1",
      laborCost: 40,
      suggestedPrice: 70,
      usageLineIds: ["u1"],
    });
    mockGetUsage.mockResolvedValue({
      pageId: "u1",
      name: "Fabric",
      materialCost: 30,
      usageType: "Material",
    });

    const result = await generateInvoiceLineItems("ORD-1");

    expect(result.adjustmentLineCreated).toBe(false);
    expect(lineOfType("Adjustment")).toBeUndefined();
    expect(result.invoiceTotal).toBe(70);
  });

  it("skips generation but still reconciles the title when the invoice already has lines", async () => {
    mockFindOrder.mockResolvedValue(order());
    mockListLines.mockResolvedValue([
      { name: "Existing", type: "Material", amount: 10 },
    ]);

    const result = await generateInvoiceLineItems("ORD-1");

    expect(mockSetTitle).toHaveBeenCalledWith("invoice-1", "ORD-1");
    expect(mockCreateLine).not.toHaveBeenCalled();
    expect(result.alreadyPresent).toBe(true);
  });

  it("skips a dangling costing-item relation instead of failing", async () => {
    mockFindOrder.mockResolvedValue(
      order({ costingItemIds: ["gone", "costing-1"] }),
    );
    mockGetCosting.mockImplementation(async (id) =>
      id === "gone"
        ? null
        : {
            pageId: "costing-1",
            laborCost: 0,
            suggestedPrice: 30,
            usageLineIds: ["u1"],
          },
    );
    mockGetUsage.mockResolvedValue({
      pageId: "u1",
      name: "Fabric",
      materialCost: 30,
      usageType: "Material",
    });

    const result = await generateInvoiceLineItems("ORD-1");
    expect(result.materialLinesCreated).toBe(1);
  });

  it("throws NotFound when the order doesn't exist", async () => {
    mockFindOrder.mockResolvedValue(null);
    await expect(generateInvoiceLineItems("ORD-x")).rejects.toThrow(
      /couldn't find an order/i,
    );
    expect(mockSetTitle).not.toHaveBeenCalled();
  });

  it("throws BadRequest when the order has no invoice", async () => {
    mockFindOrder.mockResolvedValue(order({ invoicePageId: undefined }));
    await expect(generateInvoiceLineItems("ORD-1")).rejects.toThrow(
      /no invoice/i,
    );
  });

  it("throws BadRequest when the order has no costing items", async () => {
    mockFindOrder.mockResolvedValue(order({ costingItemIds: undefined }));
    await expect(generateInvoiceLineItems("ORD-1")).rejects.toThrow(
      /no costing items/i,
    );
    // The title is still named before the costing check.
    expect(mockSetTitle).toHaveBeenCalledWith("invoice-1", "ORD-1");
  });
});
