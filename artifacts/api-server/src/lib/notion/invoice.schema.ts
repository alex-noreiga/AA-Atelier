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
export const INVOICE_PAYMENT_DEADLINE_PROPERTY = "Payment Deadline"; // date (the balance due date)
// The relation back to the order in the Order Tracking Pipeline (one invoice per
// order). Read by the payment-reminder pass to resolve the customer email off the
// order — the app looks an invoice up FROM an order everywhere else (the order's
// `Invoices` relation), so this is the only place it navigates invoice → order.
export const INVOICE_ORDER_RELATION_PROPERTY = "Order"; // relation → orders
// Per-stage payment due dates the atelier sets on the invoice. The first/second
// deposit dues are their own date properties; the balance's due date reuses
// `Payment Deadline` above. Read (not written) by the payment-reminder pass.
export const INVOICE_FIRST_DEPOSIT_DUE_PROPERTY = "First Deposit Due"; // date
export const INVOICE_SECOND_DEPOSIT_DUE_PROPERTY = "Second Deposit Due"; // date
// Per-stage "a due reminder was sent" markers, the payment analogue of the
// production schedule's `Reminder Sent` checkbox: the reminder pass flips the
// stage's marker once emailed so the nightly cron never re-sends it. An
// absent/unchecked box reads as false (a new invoice needs nothing set).
export const INVOICE_FIRST_DEPOSIT_REMINDED_PROPERTY = "First Deposit Reminded"; // checkbox
export const INVOICE_SECOND_DEPOSIT_REMINDED_PROPERTY =
  "Second Deposit Reminded"; // checkbox
export const INVOICE_BALANCE_REMINDED_PROPERTY = "Balance Reminded"; // checkbox
// `Final Balance` sums the linked line items' `Line Total`. It has been both a
// rollup and (currently) a formula in the live schema; `extractNumericValue`
// reads either, so the app doesn't care which the atelier uses.
export const INVOICE_FINAL_BALANCE_PROPERTY = "Final Balance"; // formula/rollup (number)
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

/** The three payment stages in order, for the payment-reminder pass to iterate. */
export const PAYMENT_STAGES: PaymentStage[] = [
  "first_deposit",
  "second_deposit",
  "balance",
];

/** The invoice property names + display label the payment-reminder pass reads
 * per stage: the due date, the paid checkbox (so a paid stage is skipped), and
 * the per-stage `Reminded` marker (the idempotency guard). Keyed by stage so the
 * repository/service pick fields by stage rather than branching everywhere — the
 * same shape as `DEPOSIT_STAGE_FIELDS`. The balance's due date is the shared
 * `Payment Deadline`. */
export const PAYMENT_STAGE_REMINDER_FIELDS: Record<
  PaymentStage,
  { dueProp: string; paidProp: string; remindedProp: string; label: string }
> = {
  first_deposit: {
    dueProp: INVOICE_FIRST_DEPOSIT_DUE_PROPERTY,
    paidProp: INVOICE_FIRST_DEPOSIT_PAID_PROPERTY,
    remindedProp: INVOICE_FIRST_DEPOSIT_REMINDED_PROPERTY,
    label: "First deposit",
  },
  second_deposit: {
    dueProp: INVOICE_SECOND_DEPOSIT_DUE_PROPERTY,
    paidProp: INVOICE_SECOND_DEPOSIT_PAID_PROPERTY,
    remindedProp: INVOICE_SECOND_DEPOSIT_REMINDED_PROPERTY,
    label: "Second deposit",
  },
  balance: {
    dueProp: INVOICE_PAYMENT_DEADLINE_PROPERTY,
    paidProp: INVOICE_BALANCE_PAID_PROPERTY,
    remindedProp: INVOICE_BALANCE_REMINDED_PROPERTY,
    label: "Final balance",
  },
};

// --- Invoice Line Items (the itemized lines) ---
export const LINE_ITEM_TITLE_PROPERTY = "Line Item"; // title
export const LINE_ITEM_TYPE_PROPERTY = "Line Type"; // select
export const LINE_ITEM_TOTAL_PROPERTY = "Line Total"; // formula (number)
export const LINE_ITEM_INVOICE_RELATION_PROPERTY = "Invoice"; // relation → invoice

// A defensive guard, NOT a live option. The `Line Type` select is currently
// Garment / Material / Labor / Adjustment — "Deposit" was retired as a line
// type because deposits live on the invoice HEAD (`First/Second Deposit Amount`
// + their paid checkboxes) and are credits against the total, never charges.
// The filter in `buildInvoiceView` stays so that re-adding a "Deposit" option in
// Notion can't silently bill a customer for their own deposit. Note that
// Notion's `Final Balance` has no equivalent filter, so a Deposit line would
// inflate the atelier's view while the app stayed correct — don't create one.
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
/** One credit note as the customer's invoice shows it. */
export interface InvoiceCreditView {
  creditNumber: string;
  issuedAt: string;
  amount: number;
  reason: string;
}

export interface InvoiceView {
  invoiceId: string;
  /** The studio's own invoice number (`INV-…`), once the invoice has been
   * issued. Absent on a legacy invoice, or while the database can't be read. */
  invoiceNumber?: string;
  /** When it was issued (ISO). Absent for the same reasons. */
  issuedAt?: string;
  paid: boolean;
  lineItems: InvoiceLineItemRecord[];
  subtotal: number;
  /** Credit notes raised against this invoice, when there are any. */
  credits?: InvoiceCreditView[];
  /** What they come to, in dollars. Omitted when there are none. */
  creditsTotal?: number;
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
  /** The Stripe Checkout session id of the paid balance (`Balance Payment
   * Session Id`), when the balance has been paid — used to issue a refund on
   * cancellation. Undefined when the balance is unpaid or was recorded without
   * a session id (e.g. paid offline). */
  balanceSessionId?: string;
  /** The `Final Balance` rollup (dollars), if present. Informational only — the
   * charge is computed from the non-deposit line items, not this. */
  finalBalance?: number;
  /** The `Payment Deadline` ISO date, if the atelier set one. */
  paymentDeadline?: string;
  /** The staged deposits that have an amount set, in order (first, then second). */
  deposits: InvoiceDepositView[];
}

/** One payment stage as the reminder pass sees it — only surfaced for a stage the
 * atelier has given a due date. `amount` is the dollars owed for the stage (the
 * deposit amount, or the balance = `Final Balance` − paid deposits); undefined
 * when it can't be derived (e.g. no `Final Balance` yet for the balance stage), so
 * the email just omits the figure. */
export interface PaymentReminderStage {
  stage: PaymentStage;
  label: string;
  /** The stage's due date (ISO `yyyy-mm-dd`). */
  dueDate: string;
  paid: boolean;
  /** Whether this stage's `Reminded` marker is already set. */
  reminded: boolean;
  amount?: number;
}

/** An invoice reduced to what the payment-reminder pass needs: the page (to mark
 * a stage reminded), the linked order's page id (to resolve the customer email),
 * and the payable stages that carry a due date. */
export interface PaymentReminderInvoice {
  pageId: string;
  invoiceId: string;
  /** Notion page id of the linked order (the `Order` relation), when present. */
  orderPageId?: string;
  /** Stages that have a due date set (unpaid or not — the caller filters). */
  stages: PaymentReminderStage[];
  /** How many deposits carry an amount on this invoice (0, 1 or 2), by the same
   * rule `extractInvoiceDeposits` uses. Not about reminding — it is what lets
   * the reminder email call a lone deposit on a repair "Deposit" rather than
   * "First deposit", matching the tracking page (`services/payment-labels.ts`).
   * Counted from the amounts rather than from `stages`, which only holds the
   * stages that were given a due date. */
  depositCount: number;
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
  const balanceSessionId = extractRichText(
    page,
    INVOICE_BALANCE_SESSION_PROPERTY,
  );
  return {
    pageId: page.id,
    invoiceId: extractTitle(page, INVOICE_ID_PROPERTY),
    ready: extractCheckbox(page, INVOICE_READY_PROPERTY),
    balancePaid: extractCheckbox(page, INVOICE_BALANCE_PAID_PROPERTY),
    ...(finalBalance !== undefined ? { finalBalance } : {}),
    ...(paymentDeadline !== undefined ? { paymentDeadline } : {}),
    ...(balanceSessionId !== undefined ? { balanceSessionId } : {}),
    deposits: extractInvoiceDeposits(page),
  };
}

/** The first linked page id of a relation property, or undefined when empty. */
function extractRelationFirstId(
  page: NotionInvoicePage | NotionLineItemPage,
  name: string,
): string | undefined {
  const p = page.properties[name];
  if (p?.type !== "relation") return undefined;
  return p.relation[0]?.id;
}

/**
 * Map an "invoices & payments" page into the view the payment-reminder pass reads.
 * Only stages the atelier has given a due date are surfaced (a stage with no due
 * date has nothing to remind against). Deposit amounts come from their own fields;
 * the balance owed is `Final Balance` − the deposits already marked paid (mirroring
 * `buildInvoiceView`'s `balanceDue`, without fetching line items), floored at 0 and
 * omitted when `Final Balance` isn't set yet.
 */
export function extractPaymentReminderInvoice(
  page: NotionInvoicePage,
): PaymentReminderInvoice {
  const finalBalance = extractNumericValue(
    page,
    INVOICE_FINAL_BALANCE_PROPERTY,
  );

  // The dollars already credited by paid deposits — subtracted from the balance.
  let paidDepositsTotal = 0;
  for (const depositStage of ["first_deposit", "second_deposit"] as const) {
    const fields = DEPOSIT_STAGE_FIELDS[depositStage];
    const amount = extractNumber(page, fields.amountProp);
    if (typeof amount === "number" && extractCheckbox(page, fields.paidProp)) {
      paidDepositsTotal += amount;
    }
  }

  const stages: PaymentReminderStage[] = [];
  for (const stage of PAYMENT_STAGES) {
    const fields = PAYMENT_STAGE_REMINDER_FIELDS[stage];
    const dueDate = extractDateStart(page, fields.dueProp);
    if (!dueDate) continue; // no due date → nothing to remind against

    let amount: number | undefined;
    if (stage === "balance") {
      amount =
        finalBalance !== undefined
          ? Math.max(0, finalBalance - paidDepositsTotal)
          : undefined;
    } else {
      amount = extractNumber(page, DEPOSIT_STAGE_FIELDS[stage].amountProp);
    }

    stages.push({
      stage,
      label: fields.label,
      dueDate,
      paid: extractCheckbox(page, fields.paidProp),
      reminded: extractCheckbox(page, fields.remindedProp),
      ...(amount !== undefined ? { amount } : {}),
    });
  }

  const orderPageId = extractRelationFirstId(
    page,
    INVOICE_ORDER_RELATION_PROPERTY,
  );
  return {
    pageId: page.id,
    invoiceId: extractTitle(page, INVOICE_ID_PROPERTY),
    ...(orderPageId !== undefined ? { orderPageId } : {}),
    stages,
    depositCount: extractInvoiceDeposits(page).length,
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

/** The only two things the charge rules read off a line, so the customer's
 * display record and the studio's leaner analytics record both satisfy it. */
export interface ChargeableLine {
  type: string;
  amount: number;
}

/**
 * The lines that are CHARGES — everything except a `Deposit`, which is a credit
 * against the total and lives on the invoice head, never as a line.
 *
 * Split out because two readers need the same rule and used to state it
 * separately: the customer's invoice (`buildInvoiceView`) and the studio's own
 * figures. One function, so the two totals can differ only if the inputs do.
 */
export function chargedLines<T extends ChargeableLine>(
  lineItems: readonly T[],
): T[] {
  return lineItems.filter((line) => line.type !== LINE_TYPE_DEPOSIT);
}

/**
 * What an invoice charges, in dollars — the sum of its charged lines, rounded to
 * whole cents so a float tail can't leak into a figure.
 *
 * This IS the invoice total as far as the app is concerned, for the customer and
 * the atelier alike. Notion's own `Final Balance` sums the same `Line Total`s but
 * applies no Deposit filter and, being a formula, reads as absent when it errors
 * — so deriving the number here rather than reading that property is what keeps
 * the two views of one invoice from disagreeing.
 */
export function invoiceChargedTotal(
  lineItems: readonly ChargeableLine[],
): number {
  const total = chargedLines(lineItems).reduce(
    (sum, line) => sum + line.amount,
    0,
  );
  return Math.round(total * 100) / 100;
}

/** One line as the studio analytics reads it: which invoice it belongs to, and
 * what it charges. The name isn't read — the figures are sums, not a document. */
export interface InvoiceLineAnalyticsRecord {
  /** Notion page id of the `Invoice` relation. Blank when the line is orphaned,
   * which the aggregation skips rather than guessing at. */
  invoicePageId: string;
  type: string;
  amount: number;
}

/** Map an "Invoice Line Items" page into the analytics record above. */
export function extractInvoiceLineAnalytics(
  page: NotionLineItemPage,
): InvoiceLineAnalyticsRecord {
  return {
    invoicePageId:
      extractRelationFirstId(page, LINE_ITEM_INVOICE_RELATION_PROPERTY) ?? "",
    type: extractSelectName(page, LINE_ITEM_TYPE_PROPERTY),
    amount: extractNumericValue(page, LINE_ITEM_TOTAL_PROPERTY) ?? 0,
  };
}

/** An invoice reduced to what the studio analytics aggregate: the money on it
 * and the order to attribute that money to. Deposits are kept split from the
 * balance because "deposits vs. balance" is the figure the atelier is actually
 * asking for. */
export interface InvoiceAnalyticsRecord {
  pageId: string;
  /** Notion page id of the linked order (the `Order` relation), when set. An
   * invoice with no order can't be attributed, so the aggregation skips it. */
  orderPageId?: string;
  /** The `Final Balance` (dollars) — the invoice's whole value. Undefined until
   * the invoice is itemized. */
  finalBalance?: number;
  /** Deposit dollars already paid. */
  depositsPaid: number;
  /** Deposit dollars set on the invoice but not yet paid. */
  depositsUnpaid: number;
  /** Whether the final balance is marked paid. */
  balancePaid: boolean;
}

/** Map an "invoices & payments" page into the analytics record above. */
export function extractInvoiceAnalytics(
  page: NotionInvoicePage,
): InvoiceAnalyticsRecord {
  const finalBalance = extractNumericValue(
    page,
    INVOICE_FINAL_BALANCE_PROPERTY,
  );
  const orderPageId = extractRelationFirstId(
    page,
    INVOICE_ORDER_RELATION_PROPERTY,
  );

  let depositsPaid = 0;
  let depositsUnpaid = 0;
  for (const stage of ["first_deposit", "second_deposit"] as DepositStage[]) {
    const fields = DEPOSIT_STAGE_FIELDS[stage];
    const amount = extractNumber(page, fields.amountProp);
    if (typeof amount !== "number" || amount <= 0) continue;
    if (extractCheckbox(page, fields.paidProp)) {
      depositsPaid += amount;
    } else {
      depositsUnpaid += amount;
    }
  }

  return {
    pageId: page.id,
    depositsPaid,
    depositsUnpaid,
    balancePaid: extractCheckbox(page, INVOICE_BALANCE_PAID_PROPERTY),
    ...(finalBalance !== undefined ? { finalBalance } : {}),
    ...(orderPageId !== undefined ? { orderPageId } : {}),
  };
}
