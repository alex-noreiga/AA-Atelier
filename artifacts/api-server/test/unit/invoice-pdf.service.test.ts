// The invoice PDF the atelier sees — rendered on the server from exactly what
// the customer is shown.
//
// The Notion reads/writes are mocked; the document itself is NOT. The whole
// point of the service is that `@workspace/documents` (the customer's own
// layout code) runs under Node, so these tests drive real jsPDF and assert the
// bytes are a PDF, rather than mocking the one thing worth proving.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/notion/orders.repository.js", () => ({
  findOrderByNumber: vi.fn(),
}));
vi.mock("../../src/lib/notion/invoice.repository.js", () => ({
  findInvoice: vi.fn(),
  listInvoiceLineItems: vi.fn(),
  attachInvoicePdf: vi.fn(),
}));
vi.mock("../../src/lib/notion/file-uploads.repository.js", () => ({
  uploadFileToNotion: vi.fn(),
}));

import {
  renderInvoicePdf,
  saveInvoicePdfToNotion,
} from "../../src/services/invoice-pdf.service.js";
import { findOrderByNumber } from "../../src/lib/notion/orders.repository.js";
import {
  findInvoice,
  listInvoiceLineItems,
  attachInvoicePdf,
} from "../../src/lib/notion/invoice.repository.js";
import { uploadFileToNotion } from "../../src/lib/notion/file-uploads.repository.js";
import { BadRequestError, NotFoundError } from "../../src/lib/errors.js";
import type { OrderRecord } from "../../src/lib/notion/orders.schema.js";
import type { InvoiceRecord } from "../../src/lib/notion/invoice.schema.js";

const mockFindOrder = vi.mocked(findOrderByNumber);
const mockFindInvoice = vi.mocked(findInvoice);
const mockListLines = vi.mocked(listInvoiceLineItems);
const mockAttach = vi.mocked(attachInvoicePdf);
const mockUpload = vi.mocked(uploadFileToNotion);

function order(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    orderNumber: "ORD-000002",
    orderName: "Ada – Custom Costume",
    currentStage: "Sewing/Construction",
    stages: [],
    pageId: "order-1",
    invoicePageId: "invoice-1",
    ...overrides,
  };
}

function invoice(overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    pageId: "invoice-1",
    invoiceId: "ORD-000002",
    ready: true,
    balancePaid: false,
    paymentDeadline: "2026-11-01",
    deposits: [
      {
        stage: "first_deposit",
        label: "First deposit",
        amount: 100,
        paid: true,
      },
      {
        stage: "second_deposit",
        label: "Second deposit",
        amount: 50,
        paid: false,
      },
    ],
    ...overrides,
  };
}

/** The first bytes of any PDF file: "%PDF". */
function isPdf(bytes: Buffer): boolean {
  return bytes.subarray(0, 4).toString("latin1") === "%PDF";
}

beforeEach(() => {
  mockFindOrder.mockResolvedValue(order());
  mockFindInvoice.mockResolvedValue(invoice());
  mockListLines.mockResolvedValue([
    { name: "Main fabric", type: "Material", amount: 40 },
    { name: "Construction", type: "Labor", amount: 120 },
  ]);
  mockUpload.mockResolvedValue("upload-1");
  mockAttach.mockResolvedValue("property");
});

describe("renderInvoicePdf", () => {
  it("renders a real PDF from the customer's invoice view", async () => {
    const pdf = await renderInvoicePdf("ORD-000002");

    expect(isPdf(pdf.bytes)).toBe(true);
    expect(pdf).toMatchObject({
      orderNumber: "ORD-000002",
      orderName: "Ada – Custom Costume",
      invoiceId: "ORD-000002",
      filename: "AA-Atelier-Invoice-ORD-000002.pdf",
      contentType: "application/pdf",
      lineCount: 2,
      // 160 of lines, less the one paid deposit.
      balanceDue: 60,
      paid: false,
    });
    expect(mockFindInvoice).toHaveBeenCalledWith("invoice-1");
    expect(mockListLines).toHaveBeenCalledWith("invoice-1");
  });

  it("404s an unknown order", async () => {
    mockFindOrder.mockResolvedValue(null);
    await expect(renderInvoicePdf("ORD-999999")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("refuses an order with no invoice linked, naming the fix", async () => {
    mockFindOrder.mockResolvedValue(order({ invoicePageId: undefined }));
    await expect(renderInvoicePdf("ORD-000002")).rejects.toThrow(
      /no invoice for this order yet/,
    );
    expect(mockFindInvoice).not.toHaveBeenCalled();
  });

  it("refuses an invoice relation that points at a missing page", async () => {
    mockFindInvoice.mockResolvedValue(null);
    await expect(renderInvoicePdf("ORD-000002")).rejects.toBeInstanceOf(
      BadRequestError,
    );
  });

  it("refuses an invoice the customer can't see yet, without reading its lines", async () => {
    mockFindInvoice.mockResolvedValue(invoice({ ready: false }));
    await expect(renderInvoicePdf("ORD-000002")).rejects.toThrow(
      /isn't marked ready yet/,
    );
    expect(mockListLines).not.toHaveBeenCalled();
  });

  it("stamps a paid invoice as paid", async () => {
    mockFindInvoice.mockResolvedValue(invoice({ balancePaid: true }));
    const pdf = await renderInvoicePdf("ORD-000002");
    expect(pdf.paid).toBe(true);
    expect(isPdf(pdf.bytes)).toBe(true);
  });
});

describe("saveInvoicePdfToNotion", () => {
  it("uploads the rendered bytes and attaches them to the invoice page", async () => {
    const result = await saveInvoicePdfToNotion("ORD-000002");

    expect(mockUpload).toHaveBeenCalledTimes(1);
    const upload = mockUpload.mock.calls[0][0];
    expect(upload.filename).toBe("AA-Atelier-Invoice-ORD-000002.pdf");
    expect(upload.contentType).toBe("application/pdf");
    expect(isPdf(upload.data)).toBe(true);

    expect(mockAttach).toHaveBeenCalledWith("invoice-1", {
      fileUploadId: "upload-1",
      filename: "AA-Atelier-Invoice-ORD-000002.pdf",
    });
    expect(result).toMatchObject({
      orderNumber: "ORD-000002",
      placement: "property",
      balanceDue: 60,
    });
    // One order read serves both the render and the attach.
    expect(mockFindOrder).toHaveBeenCalledTimes(1);
  });

  it("reports where the file landed when the property is missing", async () => {
    mockAttach.mockResolvedValue("page");
    const result = await saveInvoicePdfToNotion("ORD-000002");
    expect(result.placement).toBe("page");
  });

  it("writes nothing to Notion when the invoice isn't ready", async () => {
    mockFindInvoice.mockResolvedValue(invoice({ ready: false }));
    await expect(saveInvoicePdfToNotion("ORD-000002")).rejects.toBeInstanceOf(
      BadRequestError,
    );
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockAttach).not.toHaveBeenCalled();
  });

  it("doesn't attach when the upload itself failed", async () => {
    mockUpload.mockRejectedValue(new Error("Notion file upload send failed"));
    await expect(saveInvoicePdfToNotion("ORD-000002")).rejects.toThrow(
      /upload send failed/,
    );
    expect(mockAttach).not.toHaveBeenCalled();
  });
});
