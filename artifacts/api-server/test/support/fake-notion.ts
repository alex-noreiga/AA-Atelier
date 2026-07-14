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

/** Minimal Notion order page as returned by a database query. */
export function orderPage(opts: {
  orderNumber?: string;
  orderName?: string;
  currentStage?: string | null;
}) {
  return {
    id: "page-id",
    properties: {
      "Order Number": {
        type: "rich_text",
        rich_text: opts.orderNumber ? [{ plain_text: opts.orderNumber }] : [],
      },
      "Order Name": {
        type: "title",
        title: opts.orderName ? [{ plain_text: opts.orderName }] : [],
      },
      Stage: {
        type: "status",
        status:
          opts.currentStage === null || opts.currentStage === undefined
            ? null
            : { name: opts.currentStage },
      },
    },
  };
}
