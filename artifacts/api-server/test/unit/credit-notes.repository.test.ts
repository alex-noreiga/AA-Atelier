// Credit notes, through the injectable DbClient seam.
//
// Unlike `issued_invoices` there is deliberately no unique key here — an invoice
// may be credited more than once — so what this pins is the number series, the
// positive-cents convention, and the per-invoice sum the studio figures read.

import { describe, it, expect } from "vitest";
import { makeFakeDb } from "../support/fake-db.js";
import {
  createCreditNote,
  listCreditNotes,
  sumCreditsByInvoice,
} from "../../src/lib/db/credit-notes.repository.js";

const ROW = {
  credit_number: "CN-000001",
  invoice_page_id: "inv-1",
  order_number: "ORD-000002",
  issued_at: "2026-08-14T15:04:05.000Z",
  issued_by: "alexandra@example.com",
  currency: "usd",
  amount_cents: "15000",
  reason: "Rhinestoning not completed",
};

const INPUT = {
  invoicePageId: "inv-1",
  orderNumber: "ORD-000002",
  amountCents: 15000,
  reason: "Rhinestoning not completed",
  issuedBy: "alexandra@example.com",
};

describe("createCreditNote", () => {
  it("writes a POSITIVE amount and derives the number from the identity value", async () => {
    // The sign lives in the word "credit"; every consumer subtracts explicitly.
    const db = makeFakeDb(() => [ROW]);
    const note = await createCreditNote(INPUT, db);

    expect(note.amountCents).toBe(15000);
    expect(note.creditNumber).toBe("CN-000001");
    expect(db.calls[0]?.text).toContain("nextval");
    expect(db.calls[0]?.params?.[4]).toBe(15000);
  });

  it("has no conflict clause — an invoice may be credited more than once", async () => {
    const db = makeFakeDb(() => [ROW]);
    await createCreditNote(INPUT, db);

    expect(db.calls[0]?.text).not.toContain("on conflict");
  });

  it("throws when the insert returns nothing", async () => {
    const db = makeFakeDb(() => []);
    await expect(createCreditNote(INPUT, db)).rejects.toThrow();
  });
});

describe("listCreditNotes", () => {
  it("normalizes cents and the date, and orders oldest first", async () => {
    const db = makeFakeDb(() => [ROW]);
    const notes = await listCreditNotes("inv-1", db);

    expect(notes[0]?.amountCents).toBe(15000);
    expect(notes[0]?.issuedAt).toBeInstanceOf(Date);
    expect(db.calls[0]?.text).toContain("order by issued_at asc");
  });
});

describe("sumCreditsByInvoice", () => {
  it("sums per invoice in one query, not one per invoice", async () => {
    const db = makeFakeDb(() => [
      { invoice_page_id: "inv-1", credited: "15000" },
      { invoice_page_id: "inv-2", credited: 500 },
    ]);

    const sums = await sumCreditsByInvoice(db);

    expect(sums.get("inv-1")).toBe(15000);
    expect(sums.get("inv-2")).toBe(500);
    expect(db.calls).toHaveLength(1);
  });

  it("scopes the sum to the studio's currency", () => {
    // Summing across currencies would subtract euros from a dollar invoice.
    const db = makeFakeDb(() => []);
    return sumCreditsByInvoice(db).then(() => {
      expect(db.calls[0]?.text).toContain("where currency = $1");
      expect(db.calls[0]?.params).toEqual(["usd"]);
    });
  });
});
