// The payment ledger's repository, driven through the injectable DbClient seam.
//
// What's worth pinning here is the arithmetic the table exists to protect: the
// sign a caller never has to think about, the $0 movement that must not burn an
// external id, and the conflict clause that stops a webhook redelivery
// double-counting a payment.

import { describe, it, expect } from "vitest";
import { makeFakeDb } from "../support/fake-db.js";
import {
  recordPaymentEntry,
  listOrderPayments,
  listPaymentsInRange,
  type PaymentEntry,
} from "../../src/lib/db/payments.repository.js";

const PAID_AT = new Date("2026-08-14T15:04:05.000Z");

function charge(overrides: Partial<PaymentEntry> = {}): PaymentEntry {
  return {
    orderNumber: "ORD-000002",
    orderKind: "custom",
    stage: "first_deposit",
    kind: "charge",
    amountCents: 25000,
    paidAt: PAID_AT,
    externalId: "cs_test_1",
    ...overrides,
  };
}

/** Positional index of a column in the insert statement's `values (...)` list. */
const COL = {
  orderNumber: 0,
  orderKind: 1,
  stage: 2,
  kind: 3,
  amountCents: 4,
  currency: 5,
  method: 6,
  paidAt: 7,
  externalId: 8,
  paymentIntentId: 9,
  note: 10,
  recordedBy: 11,
} as const;

describe("recordPaymentEntry", () => {
  it("writes a charge as positive cents", async () => {
    const db = makeFakeDb(() => [{ id: "1" }]);
    const written = await recordPaymentEntry(charge(), db);

    expect(written).toBe(true);
    expect(db.calls[0]?.params?.[COL.amountCents]).toBe(25000);
    expect(db.calls[0]?.params?.[COL.kind]).toBe("charge");
  });

  it("writes a refund as NEGATIVE cents, from a positive amount", async () => {
    // The caller always passes a magnitude; the sign convention lives here so no
    // call site can write a refund as income.
    const db = makeFakeDb(() => [{ id: "2" }]);
    await recordPaymentEntry(
      charge({ kind: "refund", amountCents: 4000, externalId: "re_1" }),
      db,
    );

    expect(db.calls[0]?.params?.[COL.amountCents]).toBe(-4000);
    expect(db.calls[0]?.params?.[COL.kind]).toBe("refund");
  });

  it("normalizes an already-negative amount rather than double-negating it", async () => {
    const db = makeFakeDb(() => [{ id: "3" }]);
    await recordPaymentEntry(
      charge({ kind: "refund", amountCents: -4000 }),
      db,
    );

    expect(db.calls[0]?.params?.[COL.amountCents]).toBe(-4000);
  });

  it("reports a duplicate Stripe object as not written, without throwing", async () => {
    // The insert's `on conflict … do nothing` returns no row. This is the normal
    // result of a Stripe webhook redelivery, not an error — and it is the whole
    // reason at-least-once delivery can't double-count a payment.
    const db = makeFakeDb(() => []);
    expect(await recordPaymentEntry(charge(), db)).toBe(false);
  });

  it("scopes the conflict clause to the partial unique index", async () => {
    // A hand-recorded payment carries no external id and must stay insertable
    // any number of times, so the conflict target has to repeat the index's
    // predicate. Without the `where`, Postgres cannot infer the partial index at
    // all and the statement errors.
    const db = makeFakeDb(() => [{ id: "1" }]);
    await recordPaymentEntry(charge(), db);

    expect(db.calls[0]?.text).toContain(
      "on conflict (external_id) where external_id <> '' do nothing",
    );
  });

  it("refuses a $0 movement instead of burning its external id", async () => {
    // A fully-promo checkout captures nothing. Writing a zero row would change
    // no total and would claim that session id, so a later real charge against
    // it could never be recorded.
    const db = makeFakeDb(() => [{ id: "1" }]);

    expect(await recordPaymentEntry(charge({ amountCents: 0 }), db)).toBe(
      false,
    );
    expect(db.calls).toHaveLength(0);
  });

  it("defaults currency, method and the free-text columns", async () => {
    const db = makeFakeDb(() => [{ id: "1" }]);
    await recordPaymentEntry(charge(), db);

    const params = db.calls[0]?.params ?? [];
    expect(params[COL.currency]).toBe("usd");
    expect(params[COL.method]).toBe("stripe");
    expect(params[COL.paymentIntentId]).toBe("");
    expect(params[COL.note]).toBe("");
    expect(params[COL.recordedBy]).toBe("");
  });

  it("stores an omitted stage as empty text, never null", async () => {
    const db = makeFakeDb(() => [{ id: "1" }]);
    await recordPaymentEntry(
      charge({ orderKind: "shop", stage: undefined, orderNumber: "SHP-1" }),
      db,
    );

    expect(db.calls[0]?.params?.[COL.stage]).toBe("");
  });

  it("sends paid_at as an ISO instant", async () => {
    const db = makeFakeDb(() => [{ id: "1" }]);
    await recordPaymentEntry(charge(), db);

    expect(db.calls[0]?.params?.[COL.paidAt]).toBe(PAID_AT.toISOString());
  });
});

describe("reading the ledger", () => {
  const row = {
    id: 7,
    order_number: "ORD-000002",
    order_kind: "custom",
    stage: "balance",
    kind: "charge",
    // `bigint` arrives as a string on some driver paths — it must not reach a
    // caller that is about to add it up.
    amount_cents: "125000",
    currency: "usd",
    method: "stripe",
    paid_at: "2026-08-14T15:04:05.000Z",
    external_id: "cs_test_9",
    payment_intent_id: "pi_9",
    note: "",
    recorded_by: "",
  };

  it("maps a row to numbers and dates", async () => {
    const db = makeFakeDb(() => [row]);
    const [record] = await listOrderPayments("ORD-000002", db);

    expect(record?.amountCents).toBe(125000);
    expect(record?.id).toBe("7");
    expect(record?.paidAt).toBeInstanceOf(Date);
    expect(record?.paidAt.toISOString()).toBe("2026-08-14T15:04:05.000Z");
  });

  it("orders one order's history oldest first", async () => {
    const db = makeFakeDb(() => [row]);
    await listOrderPayments("ORD-000002", db);

    expect(db.calls[0]?.text).toContain("order by paid_at asc");
    expect(db.calls[0]?.params).toEqual(["ORD-000002"]);
  });

  it("queries a range half-open, so consecutive months can't double-count", async () => {
    const db = makeFakeDb(() => []);
    const from = new Date("2026-08-01T05:00:00.000Z");
    const to = new Date("2026-09-01T05:00:00.000Z");
    await listPaymentsInRange(from, to, db);

    expect(db.calls[0]?.text).toContain("paid_at >= $1 and paid_at < $2");
    expect(db.calls[0]?.params).toEqual([from.toISOString(), to.toISOString()]);
  });
});
