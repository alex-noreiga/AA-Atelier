// Read/update against the Notion "invoices & payments" database for the
// custom-order balance-payment flow. The atelier builds an invoice (line items →
// a `Final Balance` rollup) and links it to the order; the customer pays the
// remaining balance from the status page and the webhook marks it paid here.
//
// The database id comes from the optional `NOTION_INVOICES_DATABASE_ID`. When
// it's unset the client's `databaseId` is empty and reads return null (the status
// page then shows no balance action), so orders behave exactly as before until
// the env var is configured.

import { getInvoicesNotionClient, type NotionClient } from "./client.js";

export const INVOICE_FINAL_BALANCE_PROPERTY = "Final Balance"; // rollup (number)
export const INVOICE_BALANCE_PAID_PROPERTY = "Balance Paid"; // checkbox
export const INVOICE_BALANCE_SESSION_PROPERTY = "Balance Payment Session Id"; // rich_text
export const INVOICE_READY_PROPERTY = "Invoice Ready"; // checkbox

/**
 * The remaining balance due on an order (dollars): the invoice's final balance
 * minus any deposit already paid. The deposit is a separate, earlier payment, so
 * only subtract it once the customer has actually paid it. Shared by the balance
 * checkout (server-side pricing) and the status lookup (what to display).
 */
export function computeBalanceDue(
  finalBalance: number,
  depositAmount: number | undefined,
  depositPaid: boolean,
): number {
  const paidDeposit =
    depositPaid && typeof depositAmount === "number" ? depositAmount : 0;
  return finalBalance - paidDeposit;
}

/** What the balance flow needs off an invoice page. */
export interface InvoiceRecord {
  /** The invoice total (dollars): the `Final Balance` rollup over line items. */
  finalBalance: number;
  /** Whether the balance has already been paid. */
  balancePaid: boolean;
  /** Whether the atelier has marked the invoice ready to pay. */
  invoiceReady: boolean;
}

interface NotionInvoicePage {
  properties: {
    "Final Balance"?: {
      type: "rollup";
      rollup?: { type: "number"; number: number | null };
    };
    "Balance Paid"?: { type: "checkbox"; checkbox: boolean };
    "Invoice Ready"?: { type: "checkbox"; checkbox: boolean };
  };
}

function extractCheckbox(
  page: NotionInvoicePage,
  name: "Balance Paid" | "Invoice Ready",
): boolean {
  const property = page.properties[name];
  return property?.type === "checkbox" ? property.checkbox : false;
}

function extractFinalBalance(page: NotionInvoicePage): number {
  const property = page.properties[INVOICE_FINAL_BALANCE_PROPERTY];
  if (property?.type !== "rollup" || typeof property.rollup?.number !== "number") {
    return 0;
  }
  return property.rollup.number;
}

/**
 * Fetch the invoice linked to an order by its Notion page id. Returns null when
 * the invoices database isn't configured or no invoice id was given (the caller
 * then treats the order as having no payable balance).
 */
export async function findInvoiceById(
  invoicePageId: string | undefined,
  client: NotionClient = getInvoicesNotionClient(),
): Promise<InvoiceRecord | null> {
  if (!client.databaseId || !invoicePageId) {
    return null;
  }

  const response = await client.fetch(`/v1/pages/${invoicePageId}`);
  if (!response.ok) {
    throw new Error(
      `Notion invoice fetch failed with status ${response.status}`,
    );
  }

  const page = (await response.json()) as NotionInvoicePage;
  return {
    finalBalance: extractFinalBalance(page),
    balancePaid: extractCheckbox(page, INVOICE_BALANCE_PAID_PROPERTY),
    invoiceReady: extractCheckbox(page, INVOICE_READY_PROPERTY),
  };
}

/**
 * Mark an invoice's balance as paid, recording the Stripe session id. Called
 * from the webhook. Setting the same values on redelivery is harmless, so this
 * is idempotent.
 */
export async function markBalancePaid(
  invoicePageId: string,
  sessionId: string,
  client: NotionClient = getInvoicesNotionClient(),
): Promise<void> {
  if (!client.databaseId) {
    throw new Error(
      "NOTION_INVOICES_DATABASE_ID is not configured for the invoices database",
    );
  }

  const response = await client.fetch(`/v1/pages/${invoicePageId}`, {
    method: "PATCH",
    body: JSON.stringify({
      properties: {
        [INVOICE_BALANCE_PAID_PROPERTY]: { checkbox: true },
        [INVOICE_BALANCE_SESSION_PROPERTY]: {
          rich_text: [{ text: { content: sessionId } }],
        },
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Notion balance update failed with status ${response.status}: ${errorText}`,
    );
  }
}
