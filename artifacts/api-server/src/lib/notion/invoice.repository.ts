// Read/write against the atelier's existing invoice system in Notion:
// the "invoices & payments" database (the invoice head) and "Invoice Line Items"
// (the itemized lines). Mirrors the injected-client seam of the other
// repositories so it's testable with a fake, and follows the relation-filtered,
// paginated query pattern from `products.repository.ts` / the production schedule.

import {
  getInvoicesNotionClient,
  getInvoiceLineItemsNotionClient,
  type NotionClient,
} from "./client.js";
import {
  LINE_ITEM_INVOICE_RELATION_PROPERTY,
  INVOICE_ID_PROPERTY,
  stagePaymentFields,
  extractInvoice,
  extractLineItem,
  type PaymentStage,
  type InvoiceRecord,
  type InvoiceLineItemRecord,
  type NotionInvoicePage,
  type NotionInvoiceLineItemsQueryResponse,
} from "./invoice.schema.js";
import {
  buildInvoiceLineItemProperties,
  type InvoiceLineItemInput,
} from "./invoice-line-items.blocks.js";

function assertConfigured(client: NotionClient, envVar: string): void {
  if (!client.databaseId) {
    throw new Error(`${envVar} is not configured for the invoice databases`);
  }
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
