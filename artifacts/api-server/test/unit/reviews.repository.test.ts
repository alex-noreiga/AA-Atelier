import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { reviewInput } from "@workspace/test-fixtures";
import {
  createReview,
  findReviewById,
  listPublishedReviews,
  listReviewPhotos,
  listReviewsForModeration,
  setReviewStatus,
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

// --- Moderation (the studio dashboard's queue) ---

describe("listReviewsForModeration", () => {
  it("throws when the reviews database id is not configured", async () => {
    const client = makeFakeClient(() => jsonResponse({}), "");
    await expect(listReviewsForModeration(client)).rejects.toThrow(
      /NOTION_REVIEWS_DATABASE_ID is not configured/,
    );
  });

  it("queries newest-first with NO status filter, so an unrecognized status still appears", async () => {
    const client = makeFakeClient(() =>
      jsonResponse({
        results: [reviewPage({ id: "r-1", status: "Featured" })],
        has_more: false,
        next_cursor: null,
      }),
    );

    const { records, truncated } = await listReviewsForModeration(client);

    const body = JSON.parse(client.calls[0].init!.body as string);
    expect(body.filter).toBeUndefined();
    expect(body.sorts).toEqual([
      { timestamp: "created_time", direction: "descending" },
    ]);
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe("pending");
    expect(truncated).toBe(false);
  });

  it("reports a cut-short read rather than looking complete", async () => {
    const client = makeFakeClient(() =>
      jsonResponse({ results: [], has_more: true, next_cursor: "cur" }),
    );
    expect((await listReviewsForModeration(client)).truncated).toBe(true);
  });

  it("throws on a non-ok response — a staff surface fails loudly", async () => {
    const client = makeFakeClient(() => errorResponse(502));
    await expect(listReviewsForModeration(client)).rejects.toThrow(/502/);
  });
});

describe("findReviewById", () => {
  it("returns null when Notion no longer has the page", async () => {
    const client = makeFakeClient(() => errorResponse(404, "not found"));
    expect(await findReviewById("gone", client)).toBeNull();
  });

  it("maps the page to the staff projection", async () => {
    const client = makeFakeClient((path) => {
      expect(path).toBe("/v1/pages/rev-2");
      return jsonResponse(reviewPage({ id: "rev-2", status: "New" }));
    });
    expect(await findReviewById("rev-2", client)).toMatchObject({
      id: "rev-2",
      status: "pending",
    });
  });
});

describe("setReviewStatus", () => {
  it("PATCHes the Status select with the value that state writes", async () => {
    const client = makeFakeClient(() =>
      jsonResponse(reviewPage({ id: "rev-3", status: "Published" })),
    );

    const updated = await setReviewStatus("rev-3", "published", client);

    const call = client.calls[0];
    expect(call.path).toBe("/v1/pages/rev-3");
    expect(call.init?.method).toBe("PATCH");
    expect(JSON.parse(call.init!.body as string).properties).toEqual({
      Status: { select: { name: "Published" } },
    });
    expect(updated?.status).toBe("published");
  });

  it("writes the capture default when a review is sent back to the queue", async () => {
    const client = makeFakeClient(() =>
      jsonResponse(reviewPage({ status: "New" })),
    );
    await setReviewStatus("rev-4", "pending", client);
    expect(
      JSON.parse(client.calls[0].init!.body as string).properties.Status.select
        .name,
    ).toBe("New");
  });

  it("returns null for a page Notion no longer has", async () => {
    const client = makeFakeClient(() => errorResponse(404, "not found"));
    expect(await setReviewStatus("gone", "rejected", client)).toBeNull();
  });

  it("drops the published cache, so the site doesn't lag a decision", async () => {
    // Warm the cache with one published review...
    const readClient = makeFakeClient(() =>
      jsonResponse({
        results: [reviewPage({ id: "cached" })],
        has_more: false,
        next_cursor: null,
      }),
    );
    expect(await listPublishedReviews(5, readClient)).toHaveLength(1);

    // ...decide on something, then read again: it must re-query rather than
    // serve the stale list.
    const writeClient = makeFakeClient(() => jsonResponse(reviewPage({})));
    await setReviewStatus("rev-5", "published", writeClient);

    const refetch = makeFakeClient(() =>
      jsonResponse({
        results: [reviewPage({ id: "fresh" }), reviewPage({ id: "cached" })],
        has_more: false,
        next_cursor: null,
      }),
    );
    expect(await listPublishedReviews(5, refetch)).toHaveLength(2);
  });
});

describe("listReviewPhotos", () => {
  it("reads the page body's image blocks", async () => {
    const client = makeFakeClient((path) => {
      expect(path).toBe("/v1/blocks/rev-6/children?page_size=100");
      return jsonResponse({
        results: [
          { type: "quote" },
          { type: "image", image: { file: { url: "https://notion/a.png" } } },
        ],
        has_more: false,
        next_cursor: null,
      });
    });
    expect(await listReviewPhotos("rev-6", client)).toEqual([
      "https://notion/a.png",
    ]);
  });

  it("throws on a non-ok response — the caller decides to degrade", async () => {
    const client = makeFakeClient(() => errorResponse(500));
    await expect(listReviewPhotos("rev-7", client)).rejects.toThrow(/500/);
  });
});
