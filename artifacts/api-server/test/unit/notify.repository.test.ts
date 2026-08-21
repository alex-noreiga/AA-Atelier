import { describe, it, expect } from "vitest";
import { findPendingBackInStockRequests } from "../../src/lib/notion/notify.repository.js";
import {
  makeFakeClient,
  jsonResponse,
  errorResponse,
} from "../support/fake-notion.js";

describe("findPendingBackInStockRequests", () => {
  it("returns [] without querying when the contact database is unconfigured", async () => {
    const client = makeFakeClient(() => jsonResponse({}), "");
    await expect(findPendingBackInStockRequests(client)).resolves.toEqual([]);
    expect(client.calls).toHaveLength(0);
  });

  it("filters on the request type alone", async () => {
    const client = makeFakeClient(() =>
      jsonResponse({ results: [], has_more: false, next_cursor: null }),
    );

    await findPendingBackInStockRequests(client);

    const body = JSON.parse(client.calls[0].init!.body as string);
    expect(body.filter).toEqual({
      property: "Request type",
      select: { equals: "Back in stock" },
    });
  });

  it("maps each row to its page id, email, item and size", async () => {
    const client = makeFakeClient(() =>
      jsonResponse({
        results: [
          {
            id: "req-1",
            properties: {
              Email: { email: "skater@example.com" },
              Item: { rich_text: [{ plain_text: "Bow Fleece Soaker" }] },
              Size: { rich_text: [{ plain_text: "M" }] },
            },
          },
          {
            id: "req-2",
            properties: {
              Email: { email: "coach@example.com" },
              Item: { rich_text: [{ plain_text: "Blade Towel" }] },
            },
          },
        ],
        has_more: false,
        next_cursor: null,
      }),
    );

    await expect(findPendingBackInStockRequests(client)).resolves.toEqual([
      {
        pageId: "req-1",
        email: "skater@example.com",
        item: "Bow Fleece Soaker",
        size: "M",
      },
      {
        pageId: "req-2",
        email: "coach@example.com",
        item: "Blade Towel",
        size: "",
      },
    ]);
  });

  // Nobody to alert, or nothing to match them against.
  it("skips rows with no email and rows with no item", async () => {
    const client = makeFakeClient(() =>
      jsonResponse({
        results: [
          {
            id: "req-1",
            properties: {
              Email: { email: null },
              Item: { rich_text: [{ plain_text: "Soaker" }] },
            },
          },
          { id: "req-2", properties: { Email: { email: "a@example.com" } } },
        ],
        has_more: false,
        next_cursor: null,
      }),
    );

    await expect(findPendingBackInStockRequests(client)).resolves.toEqual([]);
  });

  it("follows pagination", async () => {
    let call = 0;
    const row = (id: string) => ({
      id,
      properties: {
        Email: { email: `${id}@example.com` },
        Item: { rich_text: [{ plain_text: "Soaker" }] },
      },
    });
    const client = makeFakeClient(() => {
      call += 1;
      return call === 1
        ? jsonResponse({
            results: [row("req-1")],
            has_more: true,
            next_cursor: "cursor-2",
          })
        : jsonResponse({
            results: [row("req-2")],
            has_more: false,
            next_cursor: null,
          });
    });

    const requests = await findPendingBackInStockRequests(client);

    expect(requests.map((r) => r.pageId)).toEqual(["req-1", "req-2"]);
    expect(JSON.parse(client.calls[1].init!.body as string).start_cursor).toBe(
      "cursor-2",
    );
  });

  it("throws on a query failure so the caller can retry next run", async () => {
    const client = makeFakeClient(() => errorResponse(500, "boom"));
    await expect(findPendingBackInStockRequests(client)).rejects.toThrow(
      /Notion query failed with status 500/,
    );
  });
});
