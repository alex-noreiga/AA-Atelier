import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  makeFakeClient,
  jsonResponse,
  errorResponse,
  categoryPage,
} from "../support/fake-notion.js";

// Module-level TTL cache, so re-import the module fresh per test — same approach
// as products.repository.test.ts.
let repo: typeof import("../../src/lib/notion/product-categories.repository.js");

beforeEach(async () => {
  vi.resetModules();
  repo = await import("../../src/lib/notion/product-categories.repository.js");
});

function queryResponse(
  results: unknown[],
  { hasMore = false, nextCursor = null as string | null } = {},
) {
  return jsonResponse({ results, has_more: hasMore, next_cursor: nextCursor });
}

describe("listSizedCategoryNames", () => {
  it("returns null when the database is not configured (empty id)", async () => {
    // Unset env → empty databaseId → the caller uses its fallback list.
    const client = makeFakeClient(() => jsonResponse({}), "");
    expect(await repo.listSizedCategoryNames(client)).toBeNull();
    // Must not have made a network call.
    expect(client.calls).toHaveLength(0);
  });

  it("returns the names of categories whose Show size guide is ticked", async () => {
    const client = makeFakeClient((path) => {
      if (path.endsWith("/query")) {
        return queryResponse([
          categoryPage({ name: "Dress", showSizeGuide: true }),
          categoryPage({ name: "Skate Soakers", showSizeGuide: false }),
          categoryPage({ name: "Ready to Wear", showSizeGuide: true }),
        ]);
      }
      throw new Error(`unexpected path ${path}`);
    });

    expect(await repo.listSizedCategoryNames(client)).toEqual([
      "Dress",
      "Ready to Wear",
    ]);
  });

  it("paginates through has_more / next_cursor", async () => {
    const client = makeFakeClient((path, init) => {
      if (!path.endsWith("/query")) throw new Error(`unexpected path ${path}`);
      const cursor = JSON.parse(init!.body as string).start_cursor ?? null;
      if (cursor === null) {
        return queryResponse(
          [categoryPage({ name: "Dress", showSizeGuide: true })],
          { hasMore: true, nextCursor: "cursor-2" },
        );
      }
      return queryResponse([
        categoryPage({ name: "Ready to Wear", showSizeGuide: true }),
      ]);
    });

    expect(await repo.listSizedCategoryNames(client)).toEqual([
      "Dress",
      "Ready to Wear",
    ]);
    expect(client.calls.filter((c) => c.path.endsWith("/query"))).toHaveLength(
      2,
    );
  });

  it("throws with the status when the query response is not ok", async () => {
    const client = makeFakeClient(() => errorResponse(503));
    await expect(repo.listSizedCategoryNames(client)).rejects.toThrow(
      /Notion Product Categories query failed with status 503/,
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

    it("caches for the 60s TTL, then refetches", async () => {
      const client = makeFakeClient((path) => {
        if (path.endsWith("/query")) {
          return queryResponse([
            categoryPage({ name: "Dress", showSizeGuide: true }),
          ]);
        }
        throw new Error(`unexpected path ${path}`);
      });

      await repo.listSizedCategoryNames(client);
      await repo.listSizedCategoryNames(client); // within TTL → cached
      expect(client.calls.length).toBe(1);

      vi.advanceTimersByTime(61_000);
      await repo.listSizedCategoryNames(client);
      expect(client.calls.length).toBe(2);
    });

    it("falls back to the cached names when a later fetch fails", async () => {
      let fail = false;
      const client = makeFakeClient((path) => {
        if (!path.endsWith("/query"))
          throw new Error(`unexpected path ${path}`);
        return fail
          ? errorResponse(503)
          : queryResponse([
              categoryPage({ name: "Dress", showSizeGuide: true }),
            ]);
      });

      expect(await repo.listSizedCategoryNames(client)).toEqual(["Dress"]);

      fail = true;
      vi.advanceTimersByTime(61_000);
      // Served from cache rather than throwing — a Notion blip must not drop
      // every size chart.
      expect(await repo.listSizedCategoryNames(client)).toEqual(["Dress"]);
    });
  });
});
