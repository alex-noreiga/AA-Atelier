// Credit notes — reads and writes for the append-only `credit_notes` table.
//
// A credit note is how an ISSUED invoice changes: a second document reducing
// what the first one charges, rather than an edit to a document the customer has
// already been shown. See `supabase/migrations/0007_credit_notes.sql`.
//
// Amounts are POSITIVE cents. The sign lives in the word "credit" and every
// consumer subtracts explicitly — storing them negative would let a reader add
// them to a subtotal and be right by accident, which is how a rule stops being
// checked.

import { getDb, type DbClient } from "./client.js";

export interface CreditNoteInput {
  invoicePageId: string;
  orderNumber: string;
  /** Positive integer cents. */
  amountCents: number;
  reason: string;
  currency?: string;
  issuedBy?: string;
}

export interface CreditNote {
  creditNumber: string;
  invoicePageId: string;
  orderNumber: string;
  issuedAt: Date;
  issuedBy: string;
  currency: string;
  amountCents: number;
  reason: string;
}

interface CreditNoteRow {
  credit_number: string;
  invoice_page_id: string;
  order_number: string;
  issued_at: Date | string;
  issued_by: string;
  currency: string;
  amount_cents: string | number;
  reason: string;
}

function toNumber(value: string | number): number {
  return typeof value === "number" ? value : Number(value);
}

function toCreditNote(row: CreditNoteRow): CreditNote {
  return {
    creditNumber: row.credit_number,
    invoicePageId: row.invoice_page_id,
    orderNumber: row.order_number,
    issuedAt:
      row.issued_at instanceof Date ? row.issued_at : new Date(row.issued_at),
    issuedBy: row.issued_by,
    currency: row.currency,
    amountCents: toNumber(row.amount_cents),
    reason: row.reason,
  };
}

const COLUMNS = `credit_number, invoice_page_id, order_number, issued_at,
                 issued_by, currency, amount_cents, reason`;

/**
 * Write one credit note.
 *
 * There is no conflict clause and no idempotency key, because an invoice may
 * legitimately be credited more than once. What stops a double press writing two
 * is the confirmation the dashboard asks for and the ceiling the service
 * enforces — see `credit-note.service.ts`.
 */
export async function createCreditNote(
  input: CreditNoteInput,
  db: DbClient = getDb(),
): Promise<CreditNote> {
  const rows = await db.query<CreditNoteRow>(
    `insert into credit_notes (
       credit_number, invoice_page_id, order_number, issued_by,
       currency, amount_cents, reason
     )
     values (
       'CN-' || lpad(nextval(pg_get_serial_sequence('credit_notes', 'id'))::text, 6, '0'),
       $1, $2, $3, $4, $5, $6
     )
     returning ${COLUMNS}`,
    [
      input.invoicePageId,
      input.orderNumber,
      input.issuedBy ?? "",
      input.currency ?? "usd",
      Math.round(input.amountCents),
      input.reason,
    ],
  );
  if (rows.length === 0) {
    throw new Error("Credit note insert returned no row");
  }
  return toCreditNote(rows[0]);
}

/** Every credit note against one invoice, oldest first. */
export async function listCreditNotes(
  invoicePageId: string,
  db: DbClient = getDb(),
): Promise<CreditNote[]> {
  const rows = await db.query<CreditNoteRow>(
    `select ${COLUMNS} from credit_notes
      where invoice_page_id = $1
      order by issued_at asc, credit_number asc`,
    [invoicePageId],
  );
  return rows.map(toCreditNote);
}

/** Credited cents per invoice page id, for the studio's figures — one query
 * rather than one per invoice, since the dashboard reads every invoice at once. */
export async function sumCreditsByInvoice(
  db: DbClient = getDb(),
): Promise<Map<string, number>> {
  const rows = await db.query<{
    invoice_page_id: string;
    credited: string | number;
  }>(
    `select invoice_page_id, sum(amount_cents) as credited
       from credit_notes group by invoice_page_id`,
  );
  return new Map(
    rows.map((row) => [row.invoice_page_id, toNumber(row.credited)]),
  );
}
