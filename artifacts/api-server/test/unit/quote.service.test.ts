import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Notion repositories so the quote's orchestration runs without
// network. Each test drives the reads and asserts on the writes.
vi.mock("../../src/lib/notion/orders.repository.js", () => ({
  findOrderByNumber: vi.fn(),
}));
vi.mock("../../src/lib/notion/invoice.repository.js", () => ({
  listInvoiceLineItems: vi.fn(),
  createInvoiceLineItem: vi.fn(),
  setInvoiceTitle: vi.fn(),
  setInvoiceReady: vi.fn(),
}));
vi.mock("../../src/services/invoice-issue.service.js", () => ({
  issueOrderInvoice: vi.fn(),
}));

import { quoteOrder } from "../../src/services/quote.service.js";
import { findOrderByNumber } from "../../src/lib/notion/orders.repository.js";
import {
  listInvoiceLineItems,
  createInvoiceLineItem,
  setInvoiceTitle,
  setInvoiceReady,
} from "../../src/lib/notion/invoice.repository.js";
import type { OrderRecord } from "../../src/lib/notion/orders.schema.js";
import { issueOrderInvoice } from "../../src/services/invoice-issue.service.js";

const mockFindOrder = vi.mocked(findOrderByNumber);
const mockListLines = vi.mocked(listInvoiceLineItems);
const mockCreateLine = vi.mocked(createInvoiceLineItem);
const mockSetTitle = vi.mocked(setInvoiceTitle);
const mockSetReady = vi.mocked(setInvoiceReady);

function order(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    orderNumber: "ORD-000002",
    orderName: "Ada – Repair",
    currentStage: "Piece Received",
    stages: [],
    pageId: "order-1",
    invoicePageId: "invoice-1",
    service: "Repairs & Restoration",
    ...overrides,
  };
}

beforeEach(() => {
  mockFindOrder.mockResolvedValue(order());
  mockListLines.mockResolvedValue([]);
  delete process.env.RUSH_SURCHARGE_RATE;
});

describe("quoteOrder", () => {
  it("writes one priced Service line and issues the invoice", async () => {
    const result = await quoteOrder({
      orderNumber: "ORD-000002",
      amount: 85,
      description: "Re-stone bodice",
    });

    expect(mockCreateLine).toHaveBeenCalledTimes(1);
    expect(mockCreateLine).toHaveBeenCalledWith({
      invoicePageId: "invoice-1",
      name: "Re-stone bodice",
      lineType: "Service",
      unitPrice: 85,
    });
    expect(mockSetTitle).toHaveBeenCalledWith("invoice-1", "ORD-000002");
    // Issuing ticks the gate as part of writing the document, so the quote no
    // longer sets it directly — see "a quote issues the invoice it writes".
    expect(vi.mocked(issueOrderInvoice)).toHaveBeenCalledWith(
      expect.objectContaining({ orderNumber: "ORD-000002" }),
    );
    expect(mockSetReady).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      alreadyPresent: false,
      lineName: "Re-stone bodice",
      amount: 85,
      rushSurcharge: 0,
      invoiceTotal: 85,
    });
  });

  // The line has to read as something. Falling back to the service's own word
  // for the work beats an empty title on a customer's invoice.
  it("names the line after the order's service when no description is given", async () => {
    await quoteOrder({ orderNumber: "ORD-000002", amount: 40 });
    expect(mockCreateLine).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Repair" }),
    );
  });

  it("falls back to the bespoke label for an order with no service", async () => {
    mockFindOrder.mockResolvedValue(order({ service: undefined }));
    await quoteOrder({ orderNumber: "ORD-000002", amount: 40 });
    expect(mockCreateLine).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Custom Costume" }),
    );
  });

  it("rounds the quote to whole cents", async () => {
    const result = await quoteOrder({
      orderNumber: "ORD-000002",
      amount: 85.005,
    });
    expect(mockCreateLine).toHaveBeenCalledWith(
      expect.objectContaining({ unitPrice: 85.01 }),
    );
    expect(result.invoiceTotal).toBe(85.01);
  });

  // A rush customer ticked a box accepting the surcharge at intake, so the
  // invoice has to carry it — the same reason the costing generator adds one.
  it("adds a rush surcharge line for a rush order", async () => {
    mockFindOrder.mockResolvedValue(order({ rush: true }));
    const result = await quoteOrder({ orderNumber: "ORD-000002", amount: 200 });

    expect(mockCreateLine).toHaveBeenCalledTimes(2);
    expect(mockCreateLine).toHaveBeenLastCalledWith(
      expect.objectContaining({ lineType: "Surcharge", unitPrice: 30 }),
    );
    expect(result.rushSurcharge).toBe(30);
    expect(result.invoiceTotal).toBe(230);
  });

  it("adds no surcharge when the rate is disabled", async () => {
    process.env.RUSH_SURCHARGE_RATE = "0";
    mockFindOrder.mockResolvedValue(order({ rush: true }));
    const result = await quoteOrder({ orderNumber: "ORD-000002", amount: 200 });

    expect(mockCreateLine).toHaveBeenCalledTimes(1);
    expect(result.rushSurcharge).toBe(0);
  });

  // The idempotency guard: a double press must never bill twice. Same rule as
  // the costing generator's, so the two can't fight over one invoice either.
  it("writes nothing when the invoice already has line items", async () => {
    mockListLines.mockResolvedValue([
      { name: "Labor", type: "Labor", amount: 120 },
    ]);
    const result = await quoteOrder({ orderNumber: "ORD-000002", amount: 85 });

    expect(result.alreadyPresent).toBe(true);
    expect(mockCreateLine).not.toHaveBeenCalled();
    expect(mockSetReady).not.toHaveBeenCalled();
    // The title is still reconciled — that part is idempotent by itself.
    expect(mockSetTitle).toHaveBeenCalledWith("invoice-1", "ORD-000002");
  });

  it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects a quote of %s without touching Notion",
    async (amount) => {
      await expect(
        quoteOrder({ orderNumber: "ORD-000002", amount }),
      ).rejects.toThrow(/price of the work/i);
      expect(mockFindOrder).not.toHaveBeenCalled();
      expect(mockCreateLine).not.toHaveBeenCalled();
    },
  );

  it("rejects an implausibly large quote as a typo", async () => {
    await expect(
      quoteOrder({ orderNumber: "ORD-000002", amount: 100_001 }),
    ).rejects.toThrow(/typo/i);
    expect(mockCreateLine).not.toHaveBeenCalled();
  });

  it("404s an unknown order", async () => {
    mockFindOrder.mockResolvedValue(null);
    await expect(
      quoteOrder({ orderNumber: "ORD-nope", amount: 85 }),
    ).rejects.toThrow(/couldn't find an order/i);
  });

  it("400s an order with no invoice linked", async () => {
    mockFindOrder.mockResolvedValue(order({ invoicePageId: undefined }));
    await expect(
      quoteOrder({ orderNumber: "ORD-000002", amount: 85 }),
    ).rejects.toThrow(/no invoice for this order/i);
    expect(mockCreateLine).not.toHaveBeenCalled();
  });
});

describe("a quote issues the invoice it writes", () => {
  it("issues rather than merely ticking the gate", async () => {
    // A quote is a finished invoice by construction, so it becomes a numbered,
    // dated document in one press instead of leaving a step to forget.
    vi.mocked(issueOrderInvoice).mockResolvedValue({
      orderNumber: "ORD-000002",
      invoiceNumber: "INV-000007",
      issuedAt: new Date("2026-08-14T15:04:05.000Z"),
      subtotal: 85,
      lineCount: 1,
      alreadyIssued: false,
      markedReady: true,
    });

    await quoteOrder({
      orderNumber: "ORD-000002",
      amount: 85,
      issuedBy: "alexandra@example.com",
    });

    expect(vi.mocked(issueOrderInvoice)).toHaveBeenCalledWith(
      expect.objectContaining({
        orderNumber: "ORD-000002",
        issuedBy: "alexandra@example.com",
      }),
    );
    expect(mockSetReady).not.toHaveBeenCalled();
  });

  it("degrades to the plain gate when issuing fails, keeping the quote", async () => {
    // The line is already written by this point, so a database outage must not
    // lose the quote — it falls back to the pre-issuing behaviour and the
    // atelier can issue it once the database is back.
    vi.mocked(issueOrderInvoice).mockRejectedValue(new Error("no database"));

    const result = await quoteOrder({ orderNumber: "ORD-000002", amount: 85 });

    expect(result.amount).toBe(85);
    expect(mockSetReady).toHaveBeenCalledWith("invoice-1", true);
  });
});
