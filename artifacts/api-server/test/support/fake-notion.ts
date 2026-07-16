// Test doubles for the injectable Notion client. The repository functions all
// accept a `NotionClient` as their last argument (that's the seam this suite
// exercises), so tests can drive them with a fully controlled fetch instead of
// touching the network.

import type { NotionClient } from "../../src/lib/notion/client.js";

export interface FakeCall {
  path: string;
  init?: RequestInit;
}

export interface FakeNotionClient extends NotionClient {
  /** Every fetch made through this client, in order. */
  readonly calls: FakeCall[];
}

type FetchImpl = (
  path: string,
  init?: RequestInit,
) => Response | Promise<Response>;

/**
 * Build a fake client whose `fetch` delegates to `impl`. Records every call so
 * tests can assert on the request shape (e.g. the rich_text filter body).
 */
export function makeFakeClient(
  impl: FetchImpl,
  databaseId = "test-db-id",
): FakeNotionClient {
  const calls: FakeCall[] = [];
  return {
    databaseId,
    calls,
    async fetch(path: string, init?: RequestInit): Promise<Response> {
      calls.push({ path, init });
      return impl(path, init);
    },
  };
}

/** A JSON `Response` with the given status (defaults to 200/ok). */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** A non-ok `Response` carrying a plain-text error body. */
export function errorResponse(status: number, text = "error"): Response {
  return new Response(text, { status });
}

/** Minimal Notion database schema with the given "Stage" status options. */
export function databaseSchemaWithStages(stageNames: string[]) {
  return {
    properties: {
      Stage: {
        type: "status",
        status: {
          options: stageNames.map((name, i) => ({ id: `id-${i}`, name })),
        },
      },
    },
  };
}

/** Minimal inventory database schema carrying the "Item Type" select options. */
export function inventoryDatabaseSchemaWithCategories(names: string[]) {
  return {
    properties: {
      "Item Type": {
        type: "select",
        select: { options: names.map((name) => ({ name })) },
      },
    },
  };
}

/**
 * Minimal Notion inventory page as returned by a query on the inventory
 * database. Only the properties the repository/schema read are populated; each
 * is optional so a test names just the fields it cares about.
 */
export function inventoryPage(opts: {
  id?: string;
  name?: string;
  category?: string;
  published?: boolean;
  status?: string | null;
  quantityAvailable?: number | null;
  sizesOffered?: string[];
  sizesAvailable?: string[];
}) {
  const properties: Record<string, unknown> = {
    "Item Name": {
      type: "title",
      title: opts.name ? [{ plain_text: opts.name }] : [],
    },
    "Show on website": {
      type: "checkbox",
      checkbox: opts.published ?? true,
    },
  };
  if (opts.category !== undefined) {
    properties["Item Type"] = {
      type: "select",
      select: { name: opts.category },
    };
  }
  if (opts.status !== undefined) {
    properties["Status"] = {
      type: "status",
      status: opts.status === null ? null : { name: opts.status },
    };
  }
  if (opts.quantityAvailable !== undefined) {
    properties["Quantity Available"] = {
      type: "formula",
      formula: { type: "number", number: opts.quantityAvailable },
    };
  }
  if (opts.sizesOffered !== undefined) {
    properties["Sizes Offered"] = {
      type: "multi_select",
      multi_select: opts.sizesOffered.map((name) => ({ name })),
    };
  }
  if (opts.sizesAvailable !== undefined) {
    properties["Sizes Available"] = {
      type: "multi_select",
      multi_select: opts.sizesAvailable.map((name) => ({ name })),
    };
  }
  return { id: opts.id ?? "inv-page", properties };
}

/** Minimal "Product Categories" page as returned by a query — a category name
 * plus its "Show size guide" checkbox. */
export function categoryPage(opts: {
  id?: string;
  name?: string;
  showSizeGuide?: boolean;
}) {
  return {
    id: opts.id ?? "category-page",
    properties: {
      Name: {
        type: "title",
        title: opts.name ? [{ plain_text: opts.name }] : [],
      },
      "Show size guide": {
        type: "checkbox",
        checkbox: opts.showSizeGuide ?? false,
      },
    },
  };
}

/**
 * Minimal Client CRM page as returned by a query. The upsert only reads the
 * page `id` back, so that's all this carries.
 */
export function crmClientPage(opts: { id?: string } = {}) {
  return { id: opts.id ?? "client-page" };
}

/** Minimal Notion order page as returned by a database query. Payments live on
 * the linked invoice now, so the order carries only the `Invoices` relation. */
export function orderPage(opts: {
  id?: string;
  orderNumber?: string;
  orderName?: string;
  currentStage?: string | null;
  invoicePageId?: string;
  email?: string | null;
  dueDate?: string | null;
  milestonesGenerated?: boolean;
}) {
  return {
    id: opts.id ?? "page-id",
    properties: {
      "Order Number": {
        type: "rich_text",
        rich_text: opts.orderNumber ? [{ plain_text: opts.orderNumber }] : [],
      },
      "Order Name": {
        type: "title",
        title: opts.orderName ? [{ plain_text: opts.orderName }] : [],
      },
      Email: {
        type: "email",
        email: opts.email ?? null,
      },
      Stage: {
        type: "status",
        status:
          opts.currentStage === null || opts.currentStage === undefined
            ? null
            : { name: opts.currentStage },
      },
      Invoices: {
        type: "relation",
        relation: opts.invoicePageId ? [{ id: opts.invoicePageId }] : [],
      },
      "Due Date": {
        type: "date",
        date:
          opts.dueDate === null || opts.dueDate === undefined
            ? null
            : { start: opts.dueDate, end: null },
      },
      "Milestones Generated": {
        type: "checkbox",
        checkbox: opts.milestonesGenerated ?? false,
      },
    },
  };
}

/** Minimal "invoices & payments" page (the invoice head), including its staged
 * deposits — the source of truth for what the customer pays online. */
export function invoicePage(opts: {
  id?: string;
  invoiceId?: string;
  ready?: boolean;
  balancePaid?: boolean;
  finalBalance?: number | null;
  paymentDeadline?: string | null;
  firstDepositAmount?: number | null;
  firstDepositPaid?: boolean;
  firstDepositSessionId?: string;
  secondDepositAmount?: number | null;
  secondDepositPaid?: boolean;
  secondDepositSessionId?: string;
}) {
  return {
    id: opts.id ?? "invoice-page",
    properties: {
      "Invoice ID": {
        type: "title",
        title: opts.invoiceId ? [{ plain_text: opts.invoiceId }] : [],
      },
      "Invoice Ready": {
        type: "checkbox",
        checkbox: opts.ready ?? false,
      },
      "Balance Paid": {
        type: "checkbox",
        checkbox: opts.balancePaid ?? false,
      },
      "Final Balance": {
        type: "rollup",
        rollup: { type: "number", number: opts.finalBalance ?? null },
      },
      "Payment Deadline": {
        type: "date",
        date:
          opts.paymentDeadline === null || opts.paymentDeadline === undefined
            ? null
            : { start: opts.paymentDeadline, end: null },
      },
      "First Deposit Amount": {
        type: "number",
        number: opts.firstDepositAmount ?? null,
      },
      "First Deposit Paid": {
        type: "checkbox",
        checkbox: opts.firstDepositPaid ?? false,
      },
      "First Deposit Session Id": {
        type: "rich_text",
        rich_text: opts.firstDepositSessionId
          ? [{ plain_text: opts.firstDepositSessionId }]
          : [],
      },
      "Second Deposit Amount": {
        type: "number",
        number: opts.secondDepositAmount ?? null,
      },
      "Second Deposit Paid": {
        type: "checkbox",
        checkbox: opts.secondDepositPaid ?? false,
      },
      "Second Deposit Session Id": {
        type: "rich_text",
        rich_text: opts.secondDepositSessionId
          ? [{ plain_text: opts.secondDepositSessionId }]
          : [],
      },
    },
  };
}

/** Minimal "Invoice Line Items" page. `Line Total` is a Notion formula. */
export function lineItemPage(opts: {
  id?: string;
  name?: string;
  type?: string;
  total?: number | null;
}) {
  return {
    id: opts.id ?? "line-item",
    properties: {
      "Line Item": {
        type: "title",
        title: opts.name ? [{ plain_text: opts.name }] : [],
      },
      "Line Type": {
        type: "select",
        select: opts.type ? { name: opts.type } : null,
      },
      "Line Total": {
        type: "formula",
        formula: { type: "number", number: opts.total ?? null },
      },
    },
  };
}
