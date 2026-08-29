// The payment ledger — reads and writes for the append-only `payments` table.
//
// One row per movement of money against an order: a charge is positive cents, a
// refund is negative. Rows are never updated or deleted, so an order's history
// is its rows in `paid_at` order and its current position is their sum. See
// `supabase/migrations/0005_payments.sql` for why this exists at all — in short,
// the Notion invoice records THAT a stage was paid and never WHEN, which is what
// stops the studio dashboard reporting bespoke revenue by the month it was
// collected.
//
// Stripe remains the authority on money: every refund path still asks Stripe
// what has already been refunded before issuing another (lib/stripe/refunds.ts).
// This table is the studio's own durable record of what happened, including the
// payments Stripe never saw (cash at a fitting), with the timestamps Notion
// cannot hold.

import { getDb, type DbClient } from "./client.js";
import { STUDIO_CURRENCY } from "../currency.js";

export type PaymentOrderKind = "custom" | "shop";
export type PaymentKind = "charge" | "refund";
export type PaymentMethod = "stripe" | "cash" | "check" | "transfer" | "other";

/** One movement of money, as a caller describes it.
 *
 * `amountCents` is always POSITIVE — the sign is applied from `kind` on the way
 * in (see `recordPaymentEntry`), so no caller has to remember the convention and
 * a refund can never be written as income by passing the wrong sign. */
export interface PaymentEntry {
  /** `ORD-…` or `SHP-…` — the same text the rest of the app addresses an order by. */
  orderNumber: string;
  orderKind: PaymentOrderKind;
  /** The invoice stage for a custom order; omitted for a shop order. */
  stage?: string;
  kind: PaymentKind;
  /** Positive integer cents. */
  amountCents: number;
  currency?: string;
  method?: PaymentMethod;
  /** When the money moved — NOT when we learned about it. */
  paidAt: Date;
  /** The Stripe object id that makes this row unique (Checkout session for a
   * charge, refund for a refund). Omit for a payment recorded by hand. */
  externalId?: string;
  paymentIntentId?: string;
  note?: string;
  /** Staff email, for a hand-recorded payment. */
  recordedBy?: string;
}

/** A ledger row as stored. `amountCents` is signed here, as it is in the table. */
export interface PaymentRecord {
  id: string;
  orderNumber: string;
  orderKind: PaymentOrderKind;
  stage: string;
  kind: PaymentKind;
  amountCents: number;
  currency: string;
  method: PaymentMethod;
  paidAt: Date;
  externalId: string;
  paymentIntentId: string;
  note: string;
  recordedBy: string;
}

interface PaymentRow {
  id: string | number;
  order_number: string;
  order_kind: string;
  stage: string;
  kind: string;
  amount_cents: string | number;
  currency: string;
  method: string;
  paid_at: Date | string;
  external_id: string;
  payment_intent_id: string;
  note: string;
  recorded_by: string;
}

/** `bigint` comes back from the driver as a string on some paths and a number on
 * others; normalize before any arithmetic reaches a caller. */
function toNumber(value: string | number): number {
  return typeof value === "number" ? value : Number(value);
}

function toRecord(row: PaymentRow): PaymentRecord {
  return {
    id: String(row.id),
    orderNumber: row.order_number,
    orderKind: row.order_kind as PaymentOrderKind,
    stage: row.stage,
    kind: row.kind as PaymentKind,
    amountCents: toNumber(row.amount_cents),
    currency: row.currency,
    method: row.method as PaymentMethod,
    paidAt: row.paid_at instanceof Date ? row.paid_at : new Date(row.paid_at),
    externalId: row.external_id,
    paymentIntentId: row.payment_intent_id,
    note: row.note,
    recordedBy: row.recorded_by,
  };
}

/**
 * Append one movement to the ledger.
 *
 * Returns `true` when a row was written and `false` when this Stripe object was
 * already recorded. That second case is the normal result of a webhook
 * redelivery, not an error: the partial unique index on `external_id` is what
 * stops Stripe's at-least-once delivery double-counting a payment, and
 * `on conflict do nothing` is how the insert survives it — the same claim
 * primitive `processed_payments` and `restock_alerts` use.
 *
 * A payment recorded by hand carries no `externalId`, so it is exempt from that
 * index and can legitimately repeat — a deposit paid as two piles of cash is two
 * rows.
 */
export async function recordPaymentEntry(
  entry: PaymentEntry,
  db: DbClient = getDb(),
): Promise<boolean> {
  const magnitude = Math.round(Math.abs(entry.amountCents));
  if (magnitude === 0) {
    // A $0 movement is not a payment. Recording one would put a row in the
    // ledger that changes no total and, worse, would burn the `external_id` of a
    // fully-promo session so a later real charge on it could never be recorded.
    return false;
  }
  const signed = entry.kind === "refund" ? -magnitude : magnitude;

  const inserted = await db.query<{ id: string }>(
    `insert into payments (
       order_number, order_kind, stage, kind, amount_cents, currency,
       method, paid_at, external_id, payment_intent_id, note, recorded_by
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     on conflict (external_id) where external_id <> '' do nothing
     returning id`,
    [
      entry.orderNumber,
      entry.orderKind,
      entry.stage ?? "",
      entry.kind,
      signed,
      entry.currency ?? STUDIO_CURRENCY,
      entry.method ?? "stripe",
      entry.paidAt.toISOString(),
      entry.externalId ?? "",
      entry.paymentIntentId ?? "",
      entry.note ?? "",
      entry.recordedBy ?? "",
    ],
  );
  return inserted.length > 0;
}

/** Every movement against one order, oldest first — the order's payment history. */
export async function listOrderPayments(
  orderNumber: string,
  db: DbClient = getDb(),
): Promise<PaymentRecord[]> {
  const rows = await db.query<PaymentRow>(
    `select id, order_number, order_kind, stage, kind, amount_cents, currency,
            method, paid_at, external_id, payment_intent_id, note, recorded_by
       from payments
      where order_number = $1
      order by paid_at asc, id asc`,
    [orderNumber],
  );
  return rows.map(toRecord);
}

/**
 * Every movement whose money moved inside `[from, to)`, oldest first — the shape
 * a by-month revenue figure is built from. Half-open so consecutive months
 * partition cleanly with no row counted twice.
 */
export async function listPaymentsInRange(
  from: Date,
  to: Date,
  db: DbClient = getDb(),
): Promise<PaymentRecord[]> {
  const rows = await db.query<PaymentRow>(
    `select id, order_number, order_kind, stage, kind, amount_cents, currency,
            method, paid_at, external_id, payment_intent_id, note, recorded_by
       from payments
      where paid_at >= $1 and paid_at < $2
      order by paid_at asc, id asc`,
    [from.toISOString(), to.toISOString()],
  );
  return rows.map(toRecord);
}
