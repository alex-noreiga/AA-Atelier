// The invoice as issued — reads and writes for the `issued_invoices` table.
//
// One row per invoice, written once. See
// `supabase/migrations/0006_issued_invoices.sql` for why: `Invoice Ready` was a
// checkbox rather than an event, so the document could change under a customer
// who had already been shown it. What is frozen here is the CHARGES; which
// deposits have been paid, and therefore the balance due, stay live and are
// computed at read time.

import { getDb, type DbClient } from "./client.js";
import { STUDIO_CURRENCY } from "../currency.js";

/** One charged line, as issued. Cents, like the payment ledger. */
export interface IssuedInvoiceLine {
  name: string;
  type: string;
  amountCents: number;
}

/** One staged deposit as the document recorded it. Kept for the record; the
 * live invoice head is what decides what is payable. */
export interface IssuedInvoiceDeposit {
  stage: string;
  label: string;
  amountCents: number;
}

/** What issuing writes. `invoiceNumber` is assigned by the database. */
export interface IssueInvoiceInput {
  invoicePageId: string;
  orderNumber: string;
  currency?: string;
  subtotalCents: number;
  taxed: boolean;
  lines: IssuedInvoiceLine[];
  deposits: IssuedInvoiceDeposit[];
  issuedBy?: string;
}

/** An issued invoice as stored. */
export interface IssuedInvoice {
  invoiceNumber: string;
  invoicePageId: string;
  orderNumber: string;
  issuedAt: Date;
  issuedBy: string;
  currency: string;
  subtotalCents: number;
  taxed: boolean;
  lines: IssuedInvoiceLine[];
  deposits: IssuedInvoiceDeposit[];
}

interface IssuedInvoiceRow {
  invoice_number: string;
  invoice_page_id: string;
  order_number: string;
  issued_at: Date | string;
  issued_by: string;
  currency: string;
  subtotal_cents: string | number;
  taxed: boolean;
  lines: IssuedInvoiceLine[] | string;
  deposits: IssuedInvoiceDeposit[] | string;
}

/** `bigint` arrives as a string on some driver paths; `jsonb` as an object on
 * others and text on the rest. Normalize both before anything reads them. */
function toNumber(value: string | number): number {
  return typeof value === "number" ? value : Number(value);
}

function toArray<T>(value: T[] | string): T[] {
  if (Array.isArray(value)) return value;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function toIssued(row: IssuedInvoiceRow): IssuedInvoice {
  return {
    invoiceNumber: row.invoice_number,
    invoicePageId: row.invoice_page_id,
    orderNumber: row.order_number,
    issuedAt:
      row.issued_at instanceof Date ? row.issued_at : new Date(row.issued_at),
    issuedBy: row.issued_by,
    currency: row.currency,
    subtotalCents: toNumber(row.subtotal_cents),
    taxed: row.taxed,
    lines: toArray<IssuedInvoiceLine>(row.lines),
    deposits: toArray<IssuedInvoiceDeposit>(row.deposits),
  };
}

const COLUMNS = `invoice_number, invoice_page_id, order_number, issued_at,
                 issued_by, currency, subtotal_cents, taxed, lines, deposits`;

/**
 * Issue an invoice, once.
 *
 * Returns the row that now stands — the one this call wrote, or the one that was
 * already there. The `on conflict … do nothing` plus the read-back is what makes
 * a double press safe: the unique index on `invoice_page_id` is the immutability
 * guarantee, so the second caller learns it lost rather than overwriting.
 *
 * The invoice number is derived from the row's own identity value in the same
 * statement, so nothing has to read a counter and write it back.
 */
export async function issueInvoice(
  input: IssueInvoiceInput,
  db: DbClient = getDb(),
): Promise<{ issued: IssuedInvoice; alreadyIssued: boolean }> {
  const inserted = await db.query<IssuedInvoiceRow>(
    `insert into issued_invoices (
       invoice_number, invoice_page_id, order_number, issued_by,
       currency, subtotal_cents, taxed, lines, deposits
     )
     values (
       'INV-' || lpad(nextval(pg_get_serial_sequence('issued_invoices', 'id'))::text, 6, '0'),
       $1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb
     )
     on conflict (invoice_page_id) do nothing
     returning ${COLUMNS}`,
    [
      input.invoicePageId,
      input.orderNumber,
      input.issuedBy ?? "",
      input.currency ?? STUDIO_CURRENCY,
      Math.round(input.subtotalCents),
      input.taxed,
      JSON.stringify(input.lines),
      JSON.stringify(input.deposits),
    ],
  );

  if (inserted.length > 0) {
    return { issued: toIssued(inserted[0]), alreadyIssued: false };
  }

  const existing = await findIssuedInvoice(input.invoicePageId, db);
  if (!existing) {
    // The insert conflicted and the row isn't there: a concurrent transaction
    // that has not committed. Throw rather than reporting a success with no
    // document behind it — the caller retries.
    throw new Error(
      `Invoice ${input.invoicePageId} is being issued by another request; retry`,
    );
  }
  return { issued: existing, alreadyIssued: true };
}

/** The issued invoice for one Notion invoice page, or null when never issued. */
export async function findIssuedInvoice(
  invoicePageId: string,
  db: DbClient = getDb(),
): Promise<IssuedInvoice | null> {
  const rows = await db.query<IssuedInvoiceRow>(
    `select ${COLUMNS} from issued_invoices where invoice_page_id = $1`,
    [invoicePageId],
  );
  return rows.length > 0 ? toIssued(rows[0]) : null;
}
