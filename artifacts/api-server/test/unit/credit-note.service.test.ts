// Crediting an issued invoice.
//
// Two things carry the weight: the ceiling (an invoice cannot be reduced below
// nothing, which is also what bounds a double press), and the refusal to credit
// an invoice that was never issued — a credit note credits a DOCUMENT, and an
// unissued invoice is still just editable rows.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/lib/notion/orders.repository.js", () => ({
  findOrderByNumber: vi.fn(),
}));
vi.mock("../../src/lib/notion/invoice.repository.js", () => ({
  findInvoice: vi.fn(),
}));
vi.mock("../../src/lib/db/credit-notes.repository.js", () => ({
  createCreditNote: vi.fn(),
  listCreditNotes: vi.fn(),
}));
vi.mock("../../src/services/invoice-issue.service.js", () => ({
  readIssuedInvoice: vi.fn(),
}));

import {
  creditOrderInvoice,
  readCreditNotes,
} from "../../src/services/credit-note.service.js";
import { BadRequestError, NotFoundError } from "../../src/lib/errors.js";
import { findOrderByNumber } from "../../src/lib/notion/orders.repository.js";
import { findInvoice } from "../../src/lib/notion/invoice.repository.js";
import {
  createCreditNote,
  listCreditNotes,
} from "../../src/lib/db/credit-notes.repository.js";
import { readIssuedInvoice } from "../../src/services/invoice-issue.service.js";
import type { OrderRecord } from "../../src/lib/notion/orders.schema.js";
import type { InvoiceRecord } from "../../src/lib/notion/invoice.schema.js";
import type { CreditNote } from "../../src/lib/db/credit-notes.repository.js";
import type { IssuedInvoice } from "../../src/lib/db/issued-invoices.repository.js";

const mockOrder = vi.mocked(findOrderByNumber);
const mockInvoice = vi.mocked(findInvoice);
const mockCreate = vi.mocked(createCreditNote);
const mockList = vi.mocked(listCreditNotes);
const mockIssued = vi.mocked(readIssuedInvoice);

const ISSUED = {
  invoiceNumber: "INV-000007",
  invoicePageId: "inv-1",
  orderNumber: "ORD-000002",
  issuedAt: new Date("2026-08-10T10:00:00.000Z"),
  issuedBy: "",
  currency: "usd",
  subtotalCents: 100000,
  taxed: true,
  lines: [],
  deposits: [],
} as IssuedInvoice;

function note(overrides: Partial<CreditNote> = {}): CreditNote {
  return {
    creditNumber: "CN-000001",
    invoicePageId: "inv-1",
    orderNumber: "ORD-000002",
    issuedAt: new Date("2026-08-14T15:04:05.000Z"),
    issuedBy: "",
    currency: "usd",
    amountCents: 15000,
    reason: "Rhinestoning not completed",
    ...overrides,
  };
}

const INPUT = {
  orderNumber: "ORD-000002",
  amount: 150,
  reason: "Rhinestoning not completed",
};

beforeEach(() => {
  process.env.POSTGRES_URL = "postgres://localhost/test";
  mockOrder.mockResolvedValue({
    orderNumber: "ORD-000002",
    invoicePageId: "inv-1",
  } as unknown as OrderRecord);
  mockInvoice.mockResolvedValue({
    pageId: "inv-1",
    balancePaid: false,
    deposits: [],
  } as unknown as InvoiceRecord);
  mockIssued.mockResolvedValue(ISSUED);
  mockList.mockResolvedValue([]);
  mockCreate.mockResolvedValue(note());
});

afterEach(() => {
  delete process.env.POSTGRES_URL;
});

describe("creditOrderInvoice", () => {
  it("writes the credit and reports what is left to charge", async () => {
    const result = await creditOrderInvoice({
      ...INPUT,
      issuedBy: "alexandra@example.com",
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        invoicePageId: "inv-1",
        orderNumber: "ORD-000002",
        amountCents: 15000,
        reason: "Rhinestoning not completed",
        issuedBy: "alexandra@example.com",
      }),
    );
    expect(result.creditNumber).toBe("CN-000001");
    expect(result.creditedTotal).toBe(150);
    expect(result.remaining).toBe(850);
  });

  it("refuses an invoice that was never ISSUED", async () => {
    // A credit note credits a document. An unissued invoice is still editable
    // rows — the atelier changes them and issues it.
    mockIssued.mockResolvedValue(null);

    await expect(creditOrderInvoice(INPUT)).rejects.toThrow(
      /hasn't been issued/,
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("refuses to credit more than the invoice charges", async () => {
    await expect(
      creditOrderInvoice({ ...INPUT, amount: 1200 }),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("counts credits already raised toward the ceiling", async () => {
    // This is also what bounds a double press: the second one is refused once
    // the two together would exceed the invoice.
    mockList.mockResolvedValue([note({ amountCents: 90000 })]);

    await expect(creditOrderInvoice({ ...INPUT, amount: 150 })).rejects.toThrow(
      /\$100\.00 of \$1000\.00 remains/,
    );
  });

  it("says plainly when an invoice is already fully credited", async () => {
    mockList.mockResolvedValue([note({ amountCents: 100000 })]);

    await expect(creditOrderInvoice({ ...INPUT, amount: 1 })).rejects.toThrow(
      /already fully credited/,
    );
  });

  it("allows a credit that exactly exhausts the invoice", async () => {
    mockList.mockResolvedValue([note({ amountCents: 90000 })]);
    mockCreate.mockResolvedValue(note({ amountCents: 10000 }));

    const result = await creditOrderInvoice({ ...INPUT, amount: 100 });

    expect(result.remaining).toBe(0);
  });

  it("flags a credit on an ALREADY PAID balance — that is money owed back", async () => {
    // The distinction the whole feature turns on: a credit note reduces what is
    // owed, it does not move money.
    mockInvoice.mockResolvedValue({
      pageId: "inv-1",
      balancePaid: true,
      deposits: [],
    } as unknown as InvoiceRecord);

    const result = await creditOrderInvoice(INPUT);

    expect(result.alreadyPaid).toBe(true);
  });

  it("requires a reason — the customer reads it on their invoice", async () => {
    await expect(
      creditOrderInvoice({ ...INPUT, reason: "   " }),
    ).rejects.toThrow(/Say what the credit is for/);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects $0, NaN and Infinity", async () => {
    for (const amount of [0, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(
        creditOrderInvoice({ ...INPUT, amount }),
      ).rejects.toBeInstanceOf(BadRequestError);
    }
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects a figure large enough to be a stray digit", async () => {
    await expect(
      creditOrderInvoice({ ...INPUT, amount: 250_000 }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("refuses to run without a database", async () => {
    delete process.env.POSTGRES_URL;
    await expect(creditOrderInvoice(INPUT)).rejects.toThrow(
      /need the database/,
    );
  });

  it("404s an order nobody holds", async () => {
    mockOrder.mockResolvedValue(null);
    await expect(creditOrderInvoice(INPUT)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("echoes every credit note on the invoice, so a double press is visible", async () => {
    mockList.mockResolvedValue([note({ creditNumber: "CN-000001" })]);
    mockCreate.mockResolvedValue(note({ creditNumber: "CN-000002" }));

    const result = await creditOrderInvoice({ ...INPUT, amount: 150 });

    expect(result.history).toHaveLength(2);
    expect(result.history[1]).toContain("CN-000002");
  });
});

describe("readCreditNotes", () => {
  it("distinguishes 'none' from 'we could not ask'", async () => {
    // Flattening the failure into an empty list would be indistinguishable from
    // an uncredited invoice — which is charged at its FULL amount.
    mockList.mockRejectedValue(new Error("connection refused"));

    const read = await readCreditNotes("inv-1");

    expect(read.credits).toEqual([]);
    expect(read.unavailable).toBe(true);
  });

  it("treats an unconfigured database as a true empty, not a failure", async () => {
    // Credit notes cannot exist without one, so an empty list is the answer.
    delete process.env.POSTGRES_URL;

    const read = await readCreditNotes("inv-1");

    expect(read).toEqual({ credits: [], unavailable: false });
    expect(mockList).not.toHaveBeenCalled();
  });
});
