import { describe, it, expect } from "vitest";
import { invoicePage, lineItemPage } from "../support/fake-notion.js";
import {
  extractInvoice,
  extractLineItem,
  type NotionInvoicePage,
  type NotionLineItemPage,
} from "../../src/lib/notion/invoice.schema.js";

describe("extractInvoice", () => {
  it("reads the id, gate, paid flag, rollup balance, and deadline", () => {
    const page = invoicePage({
      id: "inv-1",
      invoiceId: "Toothless",
      ready: true,
      balancePaid: false,
      finalBalance: 420,
      paymentDeadline: "2026-09-01",
    }) as NotionInvoicePage;

    expect(extractInvoice(page)).toEqual({
      pageId: "inv-1",
      invoiceId: "Toothless",
      ready: true,
      balancePaid: false,
      finalBalance: 420,
      paymentDeadline: "2026-09-01",
    });
  });

  it("omits finalBalance/paymentDeadline when unset", () => {
    const page = invoicePage({
      id: "inv-2",
      invoiceId: "Draft",
      finalBalance: null,
      paymentDeadline: null,
    }) as NotionInvoicePage;

    expect(extractInvoice(page)).toEqual({
      pageId: "inv-2",
      invoiceId: "Draft",
      ready: false,
      balancePaid: false,
    });
  });
});

describe("extractLineItem", () => {
  it("reads the name, type, and formula Line Total", () => {
    const page = lineItemPage({
      name: "Main fabric",
      type: "Material",
      total: 55.5,
    }) as NotionLineItemPage;

    expect(extractLineItem(page)).toEqual({
      name: "Main fabric",
      type: "Material",
      amount: 55.5,
    });
  });

  it("treats a line whose Line Total isn't a number as $0", () => {
    const page = lineItemPage({
      name: "Placeholder",
      type: "Garment",
      total: null,
    }) as NotionLineItemPage;

    expect(extractLineItem(page).amount).toBe(0);
  });
});
