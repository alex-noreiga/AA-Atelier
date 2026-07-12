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
