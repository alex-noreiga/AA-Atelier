// The issued-invoice record, driven through the injectable DbClient seam.
//
// The load-bearing behaviour is the conflict: `invoice_page_id` is unique, and
// that index IS the immutability guarantee. A second caller must learn it lost
// and be handed the document that already stands, never overwrite it.

import { describe, it, expect } from "vitest";
import { makeFakeDb } from "../support/fake-db.js";
import {
  issueInvoice,
  findIssuedInvoice,
} from "../../src/lib/db/issued-invoices.repository.js";

const ROW = {
  invoice_number: "INV-000007",
  invoice_page_id: "inv-1",
  order_number: "ORD-000002",
  issued_at: "2026-08-14T15:04:05.000Z",
  issued_by: "alexandra@example.com",
  currency: "usd",
  subtotal_cents: "125000",
  taxed: true,
  lines: [{ name: "Main fabric", type: "Material", amountCents: 40000 }],
  deposits: [
    { stage: "first_deposit", label: "First deposit", amountCents: 25000 },
  ],
};

const INPUT = {
  invoicePageId: "inv-1",
  orderNumber: "ORD-000002",
  subtotalCents: 125000,
  taxed: true,
  lines: [{ name: "Main fabric", type: "Material", amountCents: 40000 }],
  deposits: [
    { stage: "first_deposit", label: "First deposit", amountCents: 25000 },
  ],
  issuedBy: "alexandra@example.com",
};

describe("issueInvoice", () => {
  it("writes the document and reports it as newly issued", async () => {
    const db = makeFakeDb(() => [ROW]);
    const result = await issueInvoice(INPUT, db);

    expect(result.alreadyIssued).toBe(false);
    expect(result.issued.invoiceNumber).toBe("INV-000007");
    expect(result.issued.subtotalCents).toBe(125000);
    expect(db.calls[0]?.text).toContain("insert into issued_invoices");
  });

  it("derives the number from the row's own identity value", async () => {
    // Nothing has to read a counter and write it back, so two concurrent issues
    // can't be handed the same number.
    const db = makeFakeDb(() => [ROW]);
    await issueInvoice(INPUT, db);

    expect(db.calls[0]?.text).toContain("nextval");
    expect(db.calls[0]?.text).toContain("'INV-'");
  });

  it("refuses to overwrite: a conflict hands back the standing document", async () => {
    let call = 0;
    const db = makeFakeDb(() => {
      call += 1;
      // The insert conflicts (no returning row); the read-back finds the row.
      return call === 1 ? [] : [ROW];
    });

    const result = await issueInvoice({ ...INPUT, subtotalCents: 999999 }, db);

    expect(result.alreadyIssued).toBe(true);
    expect(result.issued.subtotalCents).toBe(125000);
    expect(db.calls[0]?.text).toContain(
      "on conflict (invoice_page_id) do nothing",
    );
  });

  it("throws when the conflict has no visible row — an uncommitted peer", async () => {
    // Reporting success with no document behind it would be the one outcome
    // worse than failing: the caller would tick the gate on nothing.
    const db = makeFakeDb(() => []);

    await expect(issueInvoice(INPUT, db)).rejects.toThrow(/retry/);
  });

  it("sends the lines and deposits as JSON", async () => {
    const db = makeFakeDb(() => [ROW]);
    await issueInvoice(INPUT, db);

    const params = db.calls[0]?.params ?? [];
    expect(JSON.parse(params[6] as string)).toEqual(INPUT.lines);
    expect(JSON.parse(params[7] as string)).toEqual(INPUT.deposits);
  });
});

describe("findIssuedInvoice", () => {
  it("normalizes bigint cents and a date, whichever form the driver returns", async () => {
    const db = makeFakeDb(() => [ROW]);
    const issued = await findIssuedInvoice("inv-1", db);

    expect(issued?.subtotalCents).toBe(125000);
    expect(issued?.issuedAt).toBeInstanceOf(Date);
    expect(issued?.lines).toHaveLength(1);
  });

  it("parses jsonb that arrives as text", async () => {
    const db = makeFakeDb(() => [
      { ...ROW, lines: JSON.stringify(ROW.lines), deposits: "[]" },
    ]);
    const issued = await findIssuedInvoice("inv-1", db);

    expect(issued?.lines[0]?.name).toBe("Main fabric");
    expect(issued?.deposits).toEqual([]);
  });

  it("returns null for an invoice never issued", async () => {
    const db = makeFakeDb(() => []);
    expect(await findIssuedInvoice("inv-nope", db)).toBeNull();
  });
});
