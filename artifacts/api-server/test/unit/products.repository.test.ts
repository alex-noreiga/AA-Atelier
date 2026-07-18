import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  makeFakeClient,
  jsonResponse,
  errorResponse,
  inventoryPage,
  type FakeNotionClient,
} from "../support/fake-notion.js";

// The repository keeps a module-level TTL cache for variants, so each test
// imports a fresh copy of the module to start from a clean cache — same approach
// as orders.repository.test.ts.
let repo: typeof import("../../src/lib/notion/products.repository.js");

beforeEach(async () => {
  vi.resetModules();
  repo = await import("../../src/lib/notion/products.repository.js");
});

const isQuery = (path: string) => path.endsWith("/query");

/** A query response page. `has_more`/`next_cursor` default to a single page. */
function queryResponse(
  results: unknown[],
  { hasMore = false, nextCursor = null as string | null } = {},
) {
  return jsonResponse({ results, has_more: hasMore, next_cursor: nextCursor });
}

describe("listVariants", () => {
  it("throws when the database id is not configured", async () => {
    const client = makeFakeClient(() => jsonResponse({}), "");
    await expect(repo.listVariants(client)).rejects.toThrow(
      /NOTION_INVENTORY_DATABASE_ID is not configured/,
    );
  });

  it("queries with the publish-checkbox filter and maps the pages", async () => {
    const client = makeFakeClient((path) => {
      if (isQuery(path)) {
        return queryResponse([
          inventoryPage({
            id: "v1",
            name: "Keyhole Dress",
            categoryId: "cat-dress",
            status: "In Stock",
          }),
        ]);
      }
      throw new Error(`unexpected path ${path}`);
    });

    const variants = await repo.listVariants(client);

    // `category` (the name) is resolved from the relation in the service; the raw
    // row carries only the linked category id.
    expect(variants).toEqual([
      {
        id: "v1",
        name: "Keyhole Dress",
        available: true,
        photos: [],
        sizes: [],
        addOnIds: [],
        category: "",
        categoryId: "cat-dress",
        group: null,
      },
    ]);

    const queryCall = client.calls.find((c) => isQuery(c.path))!;
    const body = JSON.parse(queryCall.init!.body as string);
    expect(body.filter).toEqual({
      property: "Show on website",
      checkbox: { equals: true },
    });
    expect(body.page_size).toBe(100);
  });

  it("paginates through has_more / next_cursor", async () => {
    const client = makeFakeClient((path, init) => {
      if (!isQuery(path)) throw new Error(`unexpected path ${path}`);
      const cursor = JSON.parse(init!.body as string).start_cursor ?? null;
      if (cursor === null) {
        return queryResponse([inventoryPage({ id: "v1", name: "One" })], {
          hasMore: true,
          nextCursor: "cursor-2",
        });
      }
      return queryResponse([inventoryPage({ id: "v2", name: "Two" })]);
    });

    const variants = await repo.listVariants(client);

    expect(variants.map((v) => v.id)).toEqual(["v1", "v2"]);
    const queryCalls = client.calls.filter((c) => isQuery(c.path));
    expect(queryCalls).toHaveLength(2);
    // The second page carries the cursor returned by the first.
    expect(JSON.parse(queryCalls[1].init!.body as string).start_cursor).toBe(
      "cursor-2",
    );
  });

  it("drops a page that slips through with the publish checkbox unchecked", async () => {
    // The Notion filter should already exclude these; the repository re-checks
    // defensively, and this exercises that guard.
    const client = makeFakeClient((path) => {
      if (isQuery(path)) {
        return queryResponse([
          inventoryPage({ id: "v1", name: "Shown", published: true }),
          inventoryPage({ id: "v2", name: "Hidden", published: false }),
        ]);
      }
      throw new Error(`unexpected path ${path}`);
    });

    const variants = await repo.listVariants(client);
    expect(variants.map((v) => v.id)).toEqual(["v1"]);
  });

  it("throws with the status when the query response is not ok", async () => {
    const client = makeFakeClient((path) => {
      if (isQuery(path)) return errorResponse(500);
      throw new Error(`unexpected path ${path}`);
    });
    await expect(repo.listVariants(client)).rejects.toThrow(
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
        if (isQuery(path)) {
          return queryResponse([inventoryPage({ id: "v1", name: "One" })]);
        }
        throw new Error(`unexpected path ${path}`);
      });
    }

    it("caches for the 60s TTL, then refetches", async () => {
      const client = countingClient();

      await repo.listVariants(client);
      await repo.listVariants(client); // within TTL → cached
      let queries = client.calls.filter((c) => isQuery(c.path)).length;
      expect(queries).toBe(1);

      vi.advanceTimersByTime(61_000); // past the 60s TTL
      await repo.listVariants(client);
      queries = client.calls.filter((c) => isQuery(c.path)).length;
      expect(queries).toBe(2);
    });

    it("falls back to the cached variants when a later query fails", async () => {
      let failQuery = false;
      const client = makeFakeClient((path) => {
        if (!isQuery(path)) throw new Error(`unexpected path ${path}`);
        return failQuery
          ? errorResponse(503)
          : queryResponse([inventoryPage({ id: "v1", name: "One" })]);
      });

      const first = await repo.listVariants(client);
      expect(first.map((v) => v.id)).toEqual(["v1"]);

      // The query now fails, but the cache is still usable after TTL expiry.
      failQuery = true;
      vi.advanceTimersByTime(61_000);
      const second = await repo.listVariants(client);
      expect(second.map((v) => v.id)).toEqual(["v1"]); // served from cache
    });
  });
});
