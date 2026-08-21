import { describe, it, expect } from "vitest";
import {
  listOpenRequests,
  listClosedRequests,
  findRequestById,
  setRequestStage,
} from "../../src/lib/notion/requests.repository.js";
import {
  makeFakeClient,
  jsonResponse,
  errorResponse,
  contactRequestPage,
} from "../support/fake-notion.js";

/** The one query body the fake client was asked to send. */
function queryBody(client: ReturnType<typeof makeFakeClient>) {
  return JSON.parse(client.calls[0].init!.body as string);
}

describe("listOpenRequests", () => {
  it("throws when the contact database id is not configured", async () => {
    const client = makeFakeClient(() => jsonResponse({}), "");
    await expect(listOpenRequests(client)).rejects.toThrow(
      /NOTION_CONTACT_DATABASE_ID is not configured/,
    );
  });

  // Both halves of this filter are load-bearing. `does_not_equal` matches an
  // EMPTY select too, which is what keeps a row nobody triaged in the queue —
  // the same reasoning behind the inbox's own "Open — all types" view.
  it("asks for everything not closed and not a newsletter opt-in, oldest first", async () => {
    const client = makeFakeClient(() =>
      jsonResponse({ results: [], has_more: false, next_cursor: null }),
    );

    await listOpenRequests(client);

    expect(queryBody(client).filter).toEqual({
      and: [
        { property: "Stage", select: { does_not_equal: "Closed" } },
        { property: "Request type", select: { does_not_equal: "Newsletter" } },
      ],
    });
    expect(queryBody(client).sorts).toEqual([
      { timestamp: "created_time", direction: "ascending" },
    ]);
  });

  it("maps the rows and reports a cut-short read", async () => {
    const client = makeFakeClient(() =>
      jsonResponse({
        results: [contactRequestPage({ id: "req-1" })],
        has_more: true,
        next_cursor: "next",
      }),
    );

    const { records, truncated } = await listOpenRequests(client);

    expect(records.map((r) => r.id)).toEqual(["req-1"]);
    expect(truncated).toBe(true);
  });

  // Belt and braces: the Notion filter excludes newsletter opt-ins, and the
  // extractor drops any that slip through it (a casing difference, say).
  it("drops a newsletter opt-in the filter let through", async () => {
    const client = makeFakeClient(() =>
      jsonResponse({
        results: [
          contactRequestPage({ id: "keep" }),
          contactRequestPage({ id: "drop", requestType: "newsletter" }),
        ],
        has_more: false,
        next_cursor: null,
      }),
    );

    const { records } = await listOpenRequests(client);
    expect(records.map((r) => r.id)).toEqual(["keep"]);
  });

  it("throws on a Notion error rather than serving an empty queue", async () => {
    const client = makeFakeClient(() => errorResponse(502));
    await expect(listOpenRequests(client)).rejects.toThrow(/status 502/);
  });
});

describe("listClosedRequests", () => {
  it("asks only for the closed rows, newest first, capped", async () => {
    const client = makeFakeClient(() =>
      jsonResponse({ results: [], has_more: false, next_cursor: null }),
    );

    await listClosedRequests(client, 5);

    const body = queryBody(client);
    expect(body.filter).toEqual({
      property: "Stage",
      select: { equals: "Closed" },
    });
    expect(body.sorts).toEqual([
      { timestamp: "created_time", direction: "descending" },
    ]);
    expect(body.page_size).toBe(5);
  });
});

describe("findRequestById", () => {
  it("returns null when Notion no longer has the page", async () => {
    const client = makeFakeClient(() => errorResponse(404));
    await expect(findRequestById("gone", client)).resolves.toBeNull();
  });

  it("maps the page when it exists", async () => {
    const client = makeFakeClient(() =>
      jsonResponse(contactRequestPage({ id: "req-1" })),
    );
    const record = await findRequestById("req-1", client);
    expect(record?.orderNumber).toBe("ORD-000002");
  });
});

describe("setRequestStage", () => {
  it("PATCHes the Stage select and maps the row back", async () => {
    const client = makeFakeClient(() =>
      jsonResponse(contactRequestPage({ id: "req-1", stage: "Closed" })),
    );

    const record = await setRequestStage("req-1", "closed", client);

    const call = client.calls[0];
    expect(call.path).toBe("/v1/pages/req-1");
    expect(call.init?.method).toBe("PATCH");
    expect(JSON.parse(call.init!.body as string).properties).toEqual({
      Stage: { select: { name: "Closed" } },
    });
    expect(record?.state).toBe("closed");
  });

  // Reopening writes the capture default, so the row is left exactly as a
  // freshly filed one rather than in a state only this page can produce.
  it("writes the capture default when a request is reopened", async () => {
    const client = makeFakeClient(() =>
      jsonResponse(contactRequestPage({ stage: "New" })),
    );

    await setRequestStage("req-1", "new", client);

    expect(JSON.parse(client.calls[0].init!.body as string).properties).toEqual(
      { Stage: { select: { name: "New" } } },
    );
  });

  it("returns null when the page is gone", async () => {
    const client = makeFakeClient(() => errorResponse(404));
    await expect(setRequestStage("gone", "closed", client)).resolves.toBeNull();
  });
});
