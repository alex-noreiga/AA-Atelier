import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  makeFakeClient,
  jsonResponse,
  errorResponse,
  reviewPage,
  type FakeNotionClient,
} from "../support/fake-notion.js";
import { reviewInput } from "@workspace/test-fixtures";

// The repository keeps a module-level TTL cache, so each test imports a fresh
// copy of the module to start from a clean cache — same approach as
// products.repository.test.ts.
let repo: typeof import("../../src/lib/notion/reviews.repository.js");

beforeEach(async () => {
  vi.resetModules();
  repo = await import("../../src/lib/notion/reviews.repository.js");
});

const isQuery = (path: string) => path.endsWith("/query");
const isPageCreate = (path: string) => path === "/v1/pages";

function queryResponse(
  results: unknown[],
  { hasMore = false, nextCursor = null as string | null } = {},
) {
  return jsonResponse({ results, has_more: hasMore, next_cursor: nextCursor });
}

describe("listPublishedReviews", () => {
  it("throws when the database id is not configured", async () => {
    const client = makeFakeClient(() => jsonResponse({}), "");
    await expect(repo.listPublishedReviews(client)).rejects.toThrow(
      /NOTION_REVIEWS_DATABASE_ID is not configured/,
    );
  });

  it("queries with the publish filter + newest-first sort and maps the pages", async () => {
    const client = makeFakeClient((path) => {
      if (isQuery(path)) {
        return queryResponse([
          reviewPage({ id: "r1", name: "Ada", rating: 5, body: "Lovely." }),
        ]);
      }
      throw new Error(`unexpected path ${path}`);
    });

    const reviews = await repo.listPublishedReviews(client);

    expect(reviews).toEqual([
      {
        id: "r1",
        name: "Ada",
        rating: 5,
        body: "Lovely.",
        date: "2026-01-15T12:00:00.000Z",
      },
    ]);

    const body = JSON.parse(
      client.calls.find((c) => isQuery(c.path))!.init!.body as string,
    );
    expect(body.filter).toEqual({
      property: "Published",
      checkbox: { equals: true },
    });
    expect(body.sorts).toEqual([
      { timestamp: "created_time", direction: "descending" },
    ]);
  });

  it("paginates through has_more / next_cursor", async () => {
    const client = makeFakeClient((path, init) => {
      if (!isQuery(path)) throw new Error(`unexpected path ${path}`);
      const cursor = JSON.parse(init!.body as string).start_cursor ?? null;
      if (cursor === null) {
        return queryResponse([reviewPage({ id: "r1", name: "One" })], {
          hasMore: true,
          nextCursor: "cursor-2",
        });
      }
      return queryResponse([reviewPage({ id: "r2", name: "Two" })]);
    });

    const reviews = await repo.listPublishedReviews(client);
    expect(reviews.map((r) => r.id)).toEqual(["r1", "r2"]);
  });

  it("drops a page that slips through with Published unchecked", async () => {
    const client = makeFakeClient((path) => {
      if (isQuery(path)) {
        return queryResponse([
          reviewPage({ id: "r1", name: "Shown", published: true }),
          reviewPage({ id: "r2", name: "Hidden", published: false }),
        ]);
      }
      throw new Error(`unexpected path ${path}`);
    });

    const reviews = await repo.listPublishedReviews(client);
    expect(reviews.map((r) => r.id)).toEqual(["r1"]);
  });

  it("throws with the status when the query response is not ok", async () => {
    const client = makeFakeClient((path) => {
      if (isQuery(path)) return errorResponse(500);
      throw new Error(`unexpected path ${path}`);
    });
    await expect(repo.listPublishedReviews(client)).rejects.toThrow(
      /Notion query failed with status 500/,
    );
  });

  describe("caching", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    function countingClient(): FakeNotionClient {
      return makeFakeClient((path) => {
        if (isQuery(path)) return queryResponse([reviewPage({ id: "r1" })]);
        throw new Error(`unexpected path ${path}`);
      });
    }

    it("caches for the 60s TTL, then refetches", async () => {
      const client = countingClient();

      await repo.listPublishedReviews(client);
      await repo.listPublishedReviews(client); // within TTL → cached
      expect(client.calls.filter((c) => isQuery(c.path))).toHaveLength(1);

      vi.advanceTimersByTime(61_000);
      await repo.listPublishedReviews(client);
      expect(client.calls.filter((c) => isQuery(c.path))).toHaveLength(2);
    });

    it("falls back to the cached reviews when a later query fails", async () => {
      let failQuery = false;
      const client = makeFakeClient((path) => {
        if (!isQuery(path)) throw new Error(`unexpected path ${path}`);
        return failQuery
          ? errorResponse(503)
          : queryResponse([reviewPage({ id: "r1" })]);
      });

      const first = await repo.listPublishedReviews(client);
      expect(first.map((r) => r.id)).toEqual(["r1"]);

      failQuery = true;
      vi.advanceTimersByTime(61_000);
      const second = await repo.listPublishedReviews(client);
      expect(second.map((r) => r.id)).toEqual(["r1"]); // served from cache
    });
  });
});

describe("createReview", () => {
  it("posts the built properties to the reviews database", async () => {
    const client = makeFakeClient((path) => {
      if (isPageCreate(path)) return jsonResponse({ id: "new-review" }, 200);
      throw new Error(`unexpected path ${path}`);
    });

    await repo.createReview({ verified: true, review: reviewInput() }, client);

    const call = client.calls.find((c) => isPageCreate(c.path))!;
    expect(call.init!.method).toBe("POST");
    const body = JSON.parse(call.init!.body as string);
    expect(body.parent).toEqual({ database_id: "test-db-id" });
    expect(body.properties.Published).toEqual({ checkbox: false });
    expect(body.properties.Verified).toEqual({ checkbox: true });
  });

  it("throws with the status when the create response is not ok", async () => {
    const client = makeFakeClient((path) => {
      if (isPageCreate(path)) return errorResponse(400, "bad");
      throw new Error(`unexpected path ${path}`);
    });
    await expect(
      repo.createReview({ verified: true, review: reviewInput() }, client),
    ).rejects.toThrow(/Notion review creation failed with status 400/);
  });
});
