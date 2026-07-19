// Notion schema mapping for the atelier's existing invoice system: the
// "invoices & payments" database (one invoice per custom order) and its
// "Invoice Line Items" (garment/material/labor/deposit/adjustment lines).
//
// The app READS this system to show a customer their invoice — it does not own
// the costing model. As elsewhere (see `schema.ts`), property *types* must match
// the live Notion schema, not the name, and the name literals live here so a
// Notion rename is a one-line change. The two write-back fields the app sets on
// payment (`Balance Paid` / `Balance Payment Session Id`) are plain checkbox +
// text — it never touches the costing formulas or rollups.

// --- invoices & payments (the invoice) ---
// The invoice is the source of truth for everything a customer pays online: the
// two staged deposits AND the final balance. Each stage has an amount + a paid
// checkbox + a Stripe-session-id text; the balance amount is computed from the
// line items (below) rather than stored.
export const INVOICE_ID_PROPERTY = "Invoice ID"; // title
export const INVOICE_READY_PROPERTY = "Invoice Ready"; // checkbox (the balance gate)
export const INVOICE_BALANCE_PAID_PROPERTY = "Balance Paid"; // checkbox
export const INVOICE_BALANCE_SESSION_PROPERTY = "Balance Payment Session Id"; // rich_text
export const INVOICE_PAYMENT_DEADLINE_PROPERTY = "Payment Deadline"; // date
export const INVOICE_FINAL_BALANCE_PROPERTY = "Final Balance"; // rollup (number)
// The two staged deposits, held on the invoice. Amounts are `number` (dollars),
// paid a `checkbox`, and the session id `rich_text` — property *types* must
// match the live Notion schema, not the name.
export const INVOICE_FIRST_DEPOSIT_AMOUNT_PROPERTY = "First Deposit Amount"; // number
export const INVOICE_FIRST_DEPOSIT_PAID_PROPERTY = "First Deposit Paid"; // checkbox
export const INVOICE_FIRST_DEPOSIT_SESSION_PROPERTY =
  "First Deposit Session Id"; // rich_text
export const INVOICE_SECOND_DEPOSIT_AMOUNT_PROPERTY = "Second Deposit Amount"; // number
export const INVOICE_SECOND_DEPOSIT_PAID_PROPERTY = "Second Deposit Paid"; // checkbox
export const INVOICE_SECOND_DEPOSIT_SESSION_PROPERTY =
  "Second Deposit Session Id"; // rich_text

/** A payment stage the customer can pay online. */
export type PaymentStage = "first_deposit" | "second_deposit" | "balance";
/** The two deposit stages (the balance is priced from line items, not a field). */
export type DepositStage = "first_deposit" | "second_deposit";

/** The invoice property names + display label for each deposit stage, so the
 * repository/service pick fields by stage rather than branching everywhere. */
export const DEPOSIT_STAGE_FIELDS: Record<
  DepositStage,
  { amountProp: string; paidProp: string; sessionProp: string; label: string }
> = {
  first_deposit: {
    amountProp: INVOICE_FIRST_DEPOSIT_AMOUNT_PROPERTY,
    paidProp: INVOICE_FIRST_DEPOSIT_PAID_PROPERTY,
    sessionProp: INVOICE_FIRST_DEPOSIT_SESSION_PROPERTY,
    label: "First deposit",
  },
  second_deposit: {
    amountProp: INVOICE_SECOND_DEPOSIT_AMOUNT_PROPERTY,
    paidProp: INVOICE_SECOND_DEPOSIT_PAID_PROPERTY,
    sessionProp: INVOICE_SECOND_DEPOSIT_SESSION_PROPERTY,
    label: "Second deposit",
  },
};

/** The paid-flag + session-id property names for a stage (incl. the balance). */
export function stagePaymentFields(stage: PaymentStage): {
  paidProp: string;
  sessionProp: string;
} {
  if (stage === "balance") {
    return {
      paidProp: INVOICE_BALANCE_PAID_PROPERTY,
      sessionProp: INVOICE_BALANCE_SESSION_PROPERTY,
    };
  }
  const { paidProp, sessionProp } = DEPOSIT_STAGE_FIELDS[stage];
  return { paidProp, sessionProp };
}

// --- Invoice Line Items (the itemized lines) ---
export const LINE_ITEM_TITLE_PROPERTY = "Line Item"; // title
export const LINE_ITEM_TYPE_PROPERTY = "Line Type"; // select
export const LINE_ITEM_TOTAL_PROPERTY = "Line Total"; // formula (number)
export const LINE_ITEM_INVOICE_RELATION_PROPERTY = "Invoice"; // relation → invoice

// The one line type that is NOT charged: deposits are credited against the
// balance from the order's paid-deposit amounts (see invoice.service.ts), so a
// "Deposit" line is excluded from the invoice subtotal to avoid double-counting.
// A targeted business rule naming one value, like `STATUS_IN_STOCK`.
export const LINE_TYPE_DEPOSIT = "Deposit";

/** One itemized line as the app surfaces it (non-deposit lines only). */
export interface InvoiceLineItemRecord {
  name: string;
  /** Garment / Material / Labor / Adjustment — used to group the display. */
  type: string;
  /** The line's total in dollars (`Line Total` formula). */
  amount: number;
}

/** One staged deposit as held on the invoice — the source of truth for what the
 * customer pays. Surfaced once the atelier has set its amount; only paid ones
 * credit against the balance. Shaped to the OpenAPI `InvoiceDeposit`. */
export interface InvoiceDepositView {
  stage: DepositStage;
  label: string;
  amount: number;
  paid: boolean;
  /** The Stripe session id of this paid deposit, for the on-site receipt link. */
  sessionId?: string;
}

/**
 * The customer-facing itemized invoice, shaped to the OpenAPI `Invoice`
 * contract. Built by the service from the invoice's deposits + non-deposit line
 * items. Deposits are surfaced separately (OrderStatus.deposits) because they're
 * payable before the itemized invoice is flipped "ready".
 */
export interface InvoiceView {
  invoiceId: string;
  paid: boolean;
  lineItems: InvoiceLineItemRecord[];
  subtotal: number;
  depositsCreditedTotal: number;
  balanceDue: number;
  paymentDeadline?: string;
}

/** The invoice head the app reads for an order, including its staged deposits. */
export interface InvoiceRecord {
  pageId: string;
  invoiceId: string;
  /** The "Invoice Ready" gate — the customer only sees/pays the balance once set. */
  ready: boolean;
  /** Whether the final balance has already been paid. */
  balancePaid: boolean;
  /** The `Final Balance` rollup (dollars), if present. Informational only — the
   * charge is computed from the non-deposit line items, not this. */
  finalBalance?: number;
  /** The `Payment Deadline` ISO date, if the atelier set one. */
  paymentDeadline?: string;
  /** The staged deposits that have an amount set, in order (first, then second). */
  deposits: InvoiceDepositView[];
}

// --- Raw Notion payload typing (only the property types we read) ---

interface NotionNumericValue {
  type: string;
  number?: number | null;
}

type NotionPropertyValue =
  | { type: "title"; title: Array<{ plain_text: string }> }
  | { type: "rich_text"; rich_text: Array<{ plain_text: string }> }
  | { type: "select"; select: { name: string } | null }
  | { type: "status"; status: { name: string } | null }
  | { type: "checkbox"; checkbox: boolean }
  | { type: "number"; number: number | null }
  | { type: "formula"; formula: NotionNumericValue }
  | { type: "rollup"; rollup: NotionNumericValue }
  | {
      type: "date";
      date: { start: string; end: string | null } | null;
    }
  | { type: "relation"; relation: Array<{ id: string }> };

export interface NotionInvoicePage {
  id: string;
  properties: Record<string, NotionPropertyValue | undefined>;
}

export interface NotionLineItemPage {
  id: string;
  properties: Record<string, NotionPropertyValue | undefined>;
}

export interface NotionInvoiceLineItemsQueryResponse {
  results: NotionLineItemPage[];
  has_more: boolean;
  next_cursor: string | null;
}

// --- Extractors (narrow by the runtime `type` discriminator) ---

function extractTitle(
  page: NotionInvoicePage | NotionLineItemPage,
  name: string,
): string {
  const p = page.properties[name];
  if (p?.type !== "title") return "";
  return p.title
    .map((t) => t.plain_text)
    .join("")
    .trim();
}

function extractSelectName(page: NotionLineItemPage, name: string): string {
  const p = page.properties[name];
  if (p?.type !== "select") return "";
  return p.select?.name ?? "";
}

function extractCheckbox(page: NotionInvoicePage, name: string): boolean {
  const p = page.properties[name];
  if (p?.type !== "checkbox") return false;
  return p.checkbox;
}

/** A formula (or rollup) that evaluates to a number, else undefined. */
function extractNumericValue(
  page: NotionInvoicePage | NotionLineItemPage,
  name: string,
): number | undefined {
  const p = page.properties[name];
  if (p?.type === "formula") {
    return typeof p.formula.number === "number" ? p.formula.number : undefined;
  }
  if (p?.type === "rollup") {
    return typeof p.rollup.number === "number" ? p.rollup.number : undefined;
  }
  return undefined;
}

function extractDateStart(
  page: NotionInvoicePage,
  name: string,
): string | undefined {
  const p = page.properties[name];
  if (p?.type !== "date" || !p.date?.start) return undefined;
  return p.date.start;
}

/** A plain `number` property value, else undefined. */
function extractNumber(
  page: NotionInvoicePage,
  name: string,
): number | undefined {
  const p = page.properties[name];
  if (p?.type !== "number" || typeof p.number !== "number") return undefined;
  return p.number;
}

/** A `rich_text` property joined to a string, else undefined when empty. */
function extractRichText(
  page: NotionInvoicePage,
  name: string,
): string | undefined {
  const p = page.properties[name];
  if (p?.type !== "rich_text") return undefined;
  const value = p.rich_text.map((t) => t.plain_text).join("");
  return value || undefined;
}

/** The staged deposits held on an invoice, in order — only those with an amount
 * set are surfaced. The source of truth for what the customer pays as deposits. */
export function extractInvoiceDeposits(
  page: NotionInvoicePage,
): InvoiceDepositView[] {
  const deposits: InvoiceDepositView[] = [];
  for (const stage of ["first_deposit", "second_deposit"] as DepositStage[]) {
    const fields = DEPOSIT_STAGE_FIELDS[stage];
    const amount = extractNumber(page, fields.amountProp);
    if (typeof amount !== "number" || amount <= 0) continue;
    const sessionId = extractRichText(page, fields.sessionProp);
    deposits.push({
      stage,
      label: fields.label,
      amount,
      paid: extractCheckbox(page, fields.paidProp),
      ...(sessionId !== undefined ? { sessionId } : {}),
    });
  }
  return deposits;
}

/** Map an "invoices & payments" page into the invoice head the app reads. */
export function extractInvoice(page: NotionInvoicePage): InvoiceRecord {
  const finalBalance = extractNumericValue(
    page,
    INVOICE_FINAL_BALANCE_PROPERTY,
  );
  const paymentDeadline = extractDateStart(
    page,
    INVOICE_PAYMENT_DEADLINE_PROPERTY,
  );
  return {
    pageId: page.id,
    invoiceId: extractTitle(page, INVOICE_ID_PROPERTY),
    ready: extractCheckbox(page, INVOICE_READY_PROPERTY),
    balancePaid: extractCheckbox(page, INVOICE_BALANCE_PAID_PROPERTY),
    ...(finalBalance !== undefined ? { finalBalance } : {}),
    ...(paymentDeadline !== undefined ? { paymentDeadline } : {}),
    deposits: extractInvoiceDeposits(page),
  };
}

/** Map an "Invoice Line Items" page into a domain line-item record. A line whose
 * `Line Total` doesn't resolve to a number is treated as $0. */
export function extractLineItem(
  page: NotionLineItemPage,
): InvoiceLineItemRecord {
  return {
    name: extractTitle(page, LINE_ITEM_TITLE_PROPERTY),
    type: extractSelectName(page, LINE_ITEM_TYPE_PROPERTY),
    amount: extractNumericValue(page, LINE_ITEM_TOTAL_PROPERTY) ?? 0,
  };
}
