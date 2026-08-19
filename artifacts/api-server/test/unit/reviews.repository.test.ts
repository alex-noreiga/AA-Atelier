import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { reviewInput } from "@workspace/test-fixtures";
import {
  createReview,
  listPublishedReviews,
  __resetPublishedReviewsCache,
} from "../../src/lib/notion/reviews.repository.js";
import type { ReviewRow } from "../../src/lib/notion/reviews.blocks.js";
import {
  makeFakeClient,
  jsonResponse,
  errorResponse,
  reviewPage,
} from "../support/fake-notion.js";

function row(overrides: Partial<ReviewRow> = {}): ReviewRow {
  return {
    orderNumber: "000002",
    emailVerified: true,
    request: reviewInput(),
    ...overrides,
  };
}

// Reviews live in their own database. The route/service tests mock this out, so
// this is the only place its Notion request shape and error handling are covered.
describe("createReview", () => {
  it("throws when the reviews database id is not configured", async () => {
    const client = makeFakeClient(() => jsonResponse({}), "");
    await expect(createReview(row(), client)).rejects.toThrow(
      /NOTION_REVIEWS_DATABASE_ID is not configured/,
    );
  });

  it("POSTs a page parented to the reviews database with properties and body", async () => {
    const client = makeFakeClient((path) => {
      if (path === "/v1/pages") return jsonResponse({ id: "new-page" }, 200);
      throw new Error(`unexpected path ${path}`);
    });

    await createReview(
      row({ request: reviewInput({ photoIds: ["up-1"] }) }),
      client,
      "client-3",
    );

    expect(client.calls).toHaveLength(1);
    const call = client.calls[0];
    expect(call.path).toBe("/v1/pages");
    expect(call.init?.method).toBe("POST");
    const body = JSON.parse(call.init!.body as string);
    expect(body.parent).toEqual({ database_id: "test-db-id" });
    expect(body.properties.Client).toEqual({ relation: [{ id: "client-3" }] });
    // The photo rides along as an image block in the page body.
    expect(body.children.some((b: any) => b.type === "image")).toBe(true);
  });

  it("throws with the status and Notion error text on a non-ok response", async () => {
    const client = makeFakeClient(() =>
      errorResponse(400, "validation_error: bad property"),
    );
    await expect(createReview(row(), client)).rejects.toThrow(
      /Notion review creation failed with status 400: validation_error: bad property/,
    );
  });
});

// The read half: the testimonials the site renders. Everything here is about
// what a Notion hiccup or a missing database does to a marketing page.
describe("listPublishedReviews", () => {
  beforeEach(() => {
    __resetPublishedReviewsCache();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function queryClient(pages: unknown[], databaseId = "test-db-id") {
    return makeFakeClient((path) => {
      if (path.endsWith("/query")) {
        return jsonResponse({
          results: pages,
          has_more: false,
          next_cursor: null,
        });
      }
      throw new Error(`unexpected path ${path}`);
    }, databaseId);
  }

  it("returns an empty list — not an error — when the database is unconfigured", async () => {
    const client = queryClient([], "");
    await expect(listPublishedReviews(3, client)).resolves.toEqual([]);
    // No request is even attempted.
    expect(client.calls).toHaveLength(0);
  });

  it("pushes both publish gates into the Notion filter, newest first", async () => {
    const client = queryClient([reviewPage({ id: "rev-1" })]);

    await listPublishedReviews(3, client);

    const body = JSON.parse(client.calls[0].init!.body as string);
    expect(body.filter.and).toEqual([
      { property: "Status", select: { equals: "Published" } },
      { property: "Consent to Publish", checkbox: { equals: true } },
    ]);
    expect(body.sorts).toEqual([
      { timestamp: "created_time", direction: "descending" },
    ]);
  });

  it("caps the returned list at the requested limit", async () => {
    const client = queryClient([
      reviewPage({ id: "a" }),
      reviewPage({ id: "b" }),
      reviewPage({ id: "c" }),
    ]);

    const records = await listPublishedReviews(2, client);

    expect(records.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("serves a second call from the cache without re-querying Notion", async () => {
    const client = queryClient([reviewPage({ id: "a" })]);

    await listPublishedReviews(3, client);
    await listPublishedReviews(3, client);

    expect(client.calls).toHaveLength(1);
  });

  it("re-queries once the cache TTL has elapsed", async () => {
    vi.useFakeTimers();
    const client = queryClient([reviewPage({ id: "a" })]);

    await listPublishedReviews(3, client);
    vi.advanceTimersByTime(61_000);
    await listPublishedReviews(3, client);

    expect(client.calls).toHaveLength(2);
  });

  it("falls back to the cached list when a later query fails", async () => {
    let fail = false;
    const client = makeFakeClient(() =>
      fail
        ? errorResponse(502, "bad gateway")
        : jsonResponse({
            results: [reviewPage({ id: "a" })],
            has_more: false,
            next_cursor: null,
          }),
    );

    vi.useFakeTimers();
    const first = await listPublishedReviews(3, client);
    fail = true;
    vi.advanceTimersByTime(61_000);

    await expect(listPublishedReviews(3, client)).resolves.toEqual(first);
  });

  it("throws when the very first query fails and nothing is cached", async () => {
    const client = makeFakeClient(() => errorResponse(502, "bad gateway"));

    await expect(listPublishedReviews(3, client)).rejects.toThrow(
      /Notion published-reviews query failed with status 502/,
    );
  });
});
