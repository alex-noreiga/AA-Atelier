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
  stagePaymentFields,
  extractInvoice,
  extractLineItem,
  type PaymentStage,
  type InvoiceRecord,
  type InvoiceLineItemRecord,
  type NotionInvoicePage,
  type NotionInvoiceLineItemsQueryResponse,
} from "./invoice.schema.js";

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
