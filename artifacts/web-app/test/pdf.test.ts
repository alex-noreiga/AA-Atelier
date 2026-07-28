import { describe, it, expect } from "vitest";
import type {
  Invoice,
  InvoiceDeposit,
  CheckoutSessionStatus,
} from "@workspace/api-client-react";
import { buildInvoiceDoc, invoiceFilename } from "@/lib/pdf/invoice-pdf";
import { buildReceiptDoc, receiptFilename } from "@/lib/pdf/receipt-pdf";

// Exercises the real jsPDF path (no mock) end to end, so a broken layout call —
// a bad font, a wrong jsPDF signature, a `splitTextToSize` misuse — fails here
// rather than only at runtime on a customer's click. `.save()` needs browser
// download APIs jsdom lacks, so we drive the testable `build*Doc` + filename
// halves and assert the emitted bytes are a real PDF.

/** The first bytes of any PDF file: "%PDF". */
function isPdf(bytes: ArrayBuffer): boolean {
  const header = String.fromCharCode(...new Uint8Array(bytes).slice(0, 4));
  return header === "%PDF";
}

const invoice: Invoice = {
  invoiceId: "Toothless",
  paid: false,
  lineItems: [
    { name: "Main fabric", type: "Material", amount: 40 },
    { name: "Rhinestones", type: "Material", amount: 55 },
    { name: "Construction", type: "Labor", amount: 120 },
    { name: "Design & finishing", type: "Adjustment", amount: 30 },
  ],
  subtotal: 245,
  depositsCreditedTotal: 100,
  balanceDue: 145,
  paymentDeadline: "2026-08-01",
};

const deposits: InvoiceDeposit[] = [
  { stage: "first_deposit", label: "First deposit", amount: 100, paid: true },
  { stage: "second_deposit", label: "Second deposit", amount: 50, paid: false },
];

describe("invoice PDF", () => {
  it("builds a valid PDF from an itemized invoice", () => {
    const doc = buildInvoiceDoc({
      orderNumber: "ORD-42",
      orderName: "Aurora Gown",
      invoice,
      deposits,
    });
    expect(isPdf(doc.doc.output("arraybuffer"))).toBe(true);
  });

  it("builds a valid PDF for a paid invoice with no deposits", () => {
    const doc = buildInvoiceDoc({
      orderNumber: "ORD-7",
      orderName: "Swan Dress",
      invoice: {
        ...invoice,
        paid: true,
        balanceDue: 0,
        paymentDeadline: undefined,
      },
      deposits: [],
    });
    expect(isPdf(doc.doc.output("arraybuffer"))).toBe(true);
  });

  it("names the file after the order number", () => {
    expect(invoiceFilename("ORD-42")).toBe("AA-Atelier-Invoice-ORD-42.pdf");
    expect(invoiceFilename("")).toBe("AA-Atelier-Invoice-order.pdf");
  });
});

describe("receipt PDF", () => {
  const session: CheckoutSessionStatus = {
    status: "paid",
    orderNumber: "SHP-9",
    email: "grace@example.com",
    lineItems: [{ description: "Bow Fleece Soaker", quantity: 2, amount: 44 }],
    amountSubtotal: 44,
    amountShipping: 8,
    amountTax: 1.08,
    amountTotal: 53.08,
  };

  it("builds a valid PDF from a checkout session", () => {
    const doc = buildReceiptDoc(session);
    expect(isPdf(doc.doc.output("arraybuffer"))).toBe(true);
  });

  it("builds a valid PDF when only totals are present", () => {
    const doc = buildReceiptDoc({ status: "paid", amountTotal: 8 });
    expect(isPdf(doc.doc.output("arraybuffer"))).toBe(true);
  });

  it("names the file after the order number, falling back without one", () => {
    expect(receiptFilename(session)).toBe("AA-Atelier-Receipt-SHP-9.pdf");
    expect(receiptFilename({ status: "paid" })).toBe("AA-Atelier-Receipt.pdf");
  });
});
