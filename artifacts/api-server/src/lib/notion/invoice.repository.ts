// Read/write against the atelier's existing invoice system in Notion:
// the "invoices & payments" database (the invoice head) and "Invoice Line Items"
// (the itemized lines). Mirrors the injected-client seam of the other
// repositories so it's testable with a fake, and follows the relation-filtered,
// paginated query pattern from `products.repository.ts` / the production schedule.

import {
  getInvoicesNotionClient,
  getInvoiceLineItemsNotionClient,
  type NotionClient,
  assertDatabaseConfigured,
} from "./client.js";
import { logger } from "../logger.js";
import { scanDatabase } from "./scan.js";
import {
  LINE_ITEM_INVOICE_RELATION_PROPERTY,
  INVOICE_ID_PROPERTY,
  PAYMENT_STAGES,
  PAYMENT_STAGE_REMINDER_FIELDS,
  stagePaymentFields,
  extractInvoice,
  extractLineItem,
  extractPaymentReminderInvoice,
  extractInvoiceAnalytics,
  type PaymentStage,
  type InvoiceRecord,
  type InvoiceLineItemRecord,
  type PaymentReminderInvoice,
  type InvoiceAnalyticsRecord,
  type NotionInvoicePage,
  type NotionInvoiceLineItemsQueryResponse,
} from "./invoice.schema.js";
import {
  buildInvoiceLineItemProperties,
  type InvoiceLineItemInput,
} from "./invoice-line-items.blocks.js";

function assertConfigured(client: NotionClient, envVar: string): void {
  assertDatabaseConfigured(
    client,
    `${envVar} is not configured for the invoice databases`,
  );
}

/**
 * Read an order's invoice head by its Notion page id (the order's `Invoices`
 * relation is limit-1). Returns null when the page can't be found (e.g. the
 * relation points at a deleted invoice).
 */
export async function findInvoice(
  invoicePageId: string,
  client: NotionClient = getInvoicesNotionClient(),
): Promise<InvoiceRecord | null> {
  assertConfigured(client, "NOTION_INVOICES_DATABASE_ID");

  const response = await client.fetch(`/v1/pages/${invoicePageId}`);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(
      `Notion invoice fetch failed with status ${response.status}`,
    );
  }

  const page = (await response.json()) as NotionInvoicePage;
  return extractInvoice(page);
}

/**
 * List all line items linked to an invoice, filtered by the `Invoice` relation.
 * Paginated (an invoice can exceed Notion's 100-row page).
 */
export async function listInvoiceLineItems(
  invoicePageId: string,
  client: NotionClient = getInvoiceLineItemsNotionClient(),
): Promise<InvoiceLineItemRecord[]> {
  assertConfigured(client, "NOTION_INVOICE_LINE_ITEMS_DATABASE_ID");

  const lineItems: InvoiceLineItemRecord[] = [];
  let cursor: string | null = null;

  do {
    const response = await client.fetch(
      `/v1/databases/${client.databaseId}/query`,
      {
        method: "POST",
        body: JSON.stringify({
          filter: {
            property: LINE_ITEM_INVOICE_RELATION_PROPERTY,
            relation: { contains: invoicePageId },
          },
          page_size: 100,
          ...(cursor ? { start_cursor: cursor } : {}),
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Notion query failed with status ${response.status}`);
    }

    const data = (await response.json()) as NotionInvoiceLineItemsQueryResponse;
    for (const page of data.results) {
      lineItems.push(extractLineItem(page));
    }
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);

  return lineItems;
}

/**
 * Record a paid payment stage (first deposit, second deposit, or balance) on the
 * invoice — the source of truth. The webhook calls this; setting the same values
 * on redelivery is harmless, so it's idempotent. Only the stage's two write-back
 * fields are touched — never the costing formulas/rollups.
 */
export async function markInvoicePaid(
  invoicePageId: string,
  stage: PaymentStage,
  sessionId: string,
  client: NotionClient = getInvoicesNotionClient(),
): Promise<void> {
  assertConfigured(client, "NOTION_INVOICES_DATABASE_ID");

  const { paidProp, sessionProp } = stagePaymentFields(stage);
  const response = await client.fetch(`/v1/pages/${invoicePageId}`, {
    method: "PATCH",
    body: JSON.stringify({
      properties: {
        [paidProp]: { checkbox: true },
        [sessionProp]: {
          rich_text: [{ text: { content: sessionId } }],
        },
      },
    }),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Notion invoice ${stage} paid update failed with status ${response.status}: ${errorText}`,
    );
  }
}

// The invoice properties the payment-reminder feature adds as one-time setup (the
// per-stage due dates + `Reminded` markers). If any is missing, Notion answers a
// 400 "Could not find property..." to the reminder query — we treat that exactly
// like an unset database (degrade to a no-op) so the nightly reconciliation
// doesn't fire an error-level alert every run until the atelier adds them. The
// paid checkboxes already existed for the payment flow, so they're not listed.
const PAYMENT_REMINDER_SETUP_PROPERTIES = PAYMENT_STAGES.flatMap((stage) => {
  const f = PAYMENT_STAGE_REMINDER_FIELDS[stage];
  return [f.dueProp, f.remindedProp];
});

/** Whether a non-ok response is Notion's 400 for one of the reminder setup
 * properties not existing yet (the mirror of the production schedule's
 * `isMissingReminderSentProperty`). Requires both the 400 and Notion's "could not
 * find property" message naming one of them, so an unrelated 400 still throws. */
function isMissingReminderProperty(status: number, body: string): boolean {
  return (
    status === 400 &&
    /could not find property/i.test(body) &&
    PAYMENT_REMINDER_SETUP_PROPERTIES.some((name) => body.includes(name))
  );
}

interface PaymentReminderQueryResponse {
  results: NotionInvoicePage[];
  has_more: boolean;
  next_cursor: string | null;
}

/**
 * Find invoices with a payment stage due for a reminder: a stage that's unpaid,
 * whose due date is on or before the cutoff (`now + lead days`, which naturally
 * includes already-overdue stages), and whose per-stage `Reminded` marker isn't
 * set yet. The three stages are OR'd, each as its own unpaid+due+not-reminded AND
 * group, so one query returns every candidate invoice; the caller re-derives which
 * stages qualify and emails each. Fail-soft on an unconfigured database (returns
 * `[]`), and degrades to `[]` (with a warn) when the reminder setup properties
 * aren't added yet — a query error otherwise throws so the caller logs and retries.
 */
export async function findInvoicesNeedingPaymentReminder(
  params: { onOrBefore: string },
  client: NotionClient = getInvoicesNotionClient(),
): Promise<PaymentReminderInvoice[]> {
  if (!client.databaseId) {
    return [];
  }

  const stageFilter = {
    or: PAYMENT_STAGES.map((stage) => {
      const f = PAYMENT_STAGE_REMINDER_FIELDS[stage];
      return {
        and: [
          { property: f.paidProp, checkbox: { equals: false } },
          { property: f.dueProp, date: { on_or_before: params.onOrBefore } },
          { property: f.remindedProp, checkbox: { equals: false } },
        ],
      };
    }),
  };

  const invoices: PaymentReminderInvoice[] = [];
  let cursor: string | null = null;

  do {
    const response = await client.fetch(
      `/v1/databases/${client.databaseId}/query`,
      {
        method: "POST",
        body: JSON.stringify({
          filter: stageFilter,
          page_size: 100,
          ...(cursor ? { start_cursor: cursor } : {}),
        }),
      },
    );

    if (!response.ok) {
      const body = await response.text();
      if (isMissingReminderProperty(response.status, body)) {
        logger.warn(
          `Payment reminders skipped: the invoice due-date / "Reminded" ` +
            `properties are missing from the invoices & payments database. ` +
            `Add them to enable payment reminders (see CLAUDE.md "Payment & ` +
            `deposit due reminders").`,
        );
        return [];
      }
      throw new Error(
        `Notion query failed with status ${response.status}: ${body}`,
      );
    }

    const data = (await response.json()) as PaymentReminderQueryResponse;
    for (const page of data.results) {
      invoices.push(extractPaymentReminderInvoice(page));
    }
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);

  return invoices;
}

/** Mark one payment stage's due reminder as sent (flips its `Reminded` checkbox),
 * so the nightly reconciliation doesn't re-send it. Touches only that one field. */
export async function markPaymentStageReminded(
  invoicePageId: string,
  stage: PaymentStage,
  client: NotionClient = getInvoicesNotionClient(),
): Promise<void> {
  assertConfigured(client, "NOTION_INVOICES_DATABASE_ID");

  const { remindedProp } = PAYMENT_STAGE_REMINDER_FIELDS[stage];
  const response = await client.fetch(`/v1/pages/${invoicePageId}`, {
    method: "PATCH",
    body: JSON.stringify({
      properties: { [remindedProp]: { checkbox: true } },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Notion invoice ${stage} reminder marker update failed with status ${response.status}: ${errorText}`,
    );
  }
}

/**
 * Create one "Invoice Line Items" row from the generator's input. Prices via
 * `Manual Unit Price` at quantity 1 and never links the costing item (see
 * `invoice-line-items.blocks.ts` for why), so a material/labor/adjustment line's
 * `Line Total` is exactly the amount we computed.
 */
export async function createInvoiceLineItem(
  input: InvoiceLineItemInput,
  client: NotionClient = getInvoiceLineItemsNotionClient(),
): Promise<void> {
  assertConfigured(client, "NOTION_INVOICE_LINE_ITEMS_DATABASE_ID");

  const response = await client.fetch("/v1/pages", {
    method: "POST",
    body: JSON.stringify({
      parent: { database_id: client.databaseId },
      properties: buildInvoiceLineItemProperties(input),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Notion invoice line item creation failed with status ${response.status}: ${errorText}`,
    );
  }
}

/**
 * Set an invoice's title (`Invoice ID`) — the generator names it after the
 * order's `ORD-` number. Display-only: the app looks an invoice up via the
 * order's `Invoices` relation, never by this title, so renaming it is safe.
 */
export async function setInvoiceTitle(
  invoicePageId: string,
  title: string,
  client: NotionClient = getInvoicesNotionClient(),
): Promise<void> {
  assertConfigured(client, "NOTION_INVOICES_DATABASE_ID");

  const response = await client.fetch(`/v1/pages/${invoicePageId}`, {
    method: "PATCH",
    body: JSON.stringify({
      properties: {
        [INVOICE_ID_PROPERTY]: {
          title: [{ text: { content: title } }],
        },
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Notion invoice title update failed with status ${response.status}: ${errorText}`,
    );
  }
}

/**
 * Read every invoice for the studio analytics — a bounded full-database scan,
 * the invoice counterpart of `listOrdersForAnalytics`. One scan replaces a
 * per-order invoice fetch, which for a few hundred orders would be a few hundred
 * requests; the caller joins each invoice to its order by the `Order` relation.
 */
export async function listInvoicesForAnalytics(
  client: NotionClient = getInvoicesNotionClient(),
): Promise<InvoiceAnalyticsRecord[]> {
  assertConfigured(client, "NOTION_INVOICES_DATABASE_ID");

  const pages = await scanDatabase<NotionInvoicePage>(client, "invoices");
  return pages.map(extractInvoiceAnalytics);
}
