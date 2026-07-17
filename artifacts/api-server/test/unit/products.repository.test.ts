import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  makeFakeClient,
  jsonResponse,
  errorResponse,
  inventoryPage,
  inventoryDatabaseSchemaWithCategories,
  type FakeNotionClient,
} from "../support/fake-notion.js";

// The repository keeps two module-level TTL caches (variants + categories), so
// each test imports a fresh copy of the module to start from a clean cache —
// same approach as orders.repository.test.ts.
let repo: typeof import("../../src/lib/notion/products.repository.js");

beforeEach(async () => {
  vi.resetModules();
  repo = await import("../../src/lib/notion/products.repository.js");
});

const isQuery = (path: string) => path.endsWith("/query");
const isSchema = (path: string) => /\/v1\/databases\/[^/]+$/.test(path);

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
            category: "Dress",
            status: "In Stock",
          }),
        ]);
      }
      throw new Error(`unexpected path ${path}`);
    });

    const variants = await repo.listVariants(client);

    expect(variants).toEqual([
      {
        id: "v1",
        name: "Keyhole Dress",
        available: true,
        photos: [],
        sizes: [],
        category: "Dress",
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

describe("listCategories", () => {
  it("throws when the database id is not configured", async () => {
    const client = makeFakeClient(() => jsonResponse({}), "");
    await expect(repo.listCategories(client)).rejects.toThrow(
      /NOTION_INVENTORY_DATABASE_ID is not configured/,
    );
  });

  it("reads the live Item Type options in Notion's order", async () => {
    const client = makeFakeClient((path) => {
      if (isSchema(path)) {
        return jsonResponse(
          inventoryDatabaseSchemaWithCategories(["Dress", "Soaker", "Other"]),
        );
      }
      throw new Error(`unexpected path ${path}`);
    });

    expect(await repo.listCategories(client)).toEqual([
      "Dress",
      "Soaker",
      "Other",
    ]);
  });

  it("throws with the status when the schema response is not ok", async () => {
    const client = makeFakeClient((path) => {
      if (isSchema(path)) return errorResponse(503);
      throw new Error(`unexpected path ${path}`);
    });
    await expect(repo.listCategories(client)).rejects.toThrow(
      /Notion database schema fetch failed with status 503/,
    );
  });

  describe("size-chart config-drift guard", () => {
    it("logs an error when a size-chart Item Type value is missing from the live options", async () => {
      // logger is imported as part of the (already-loaded) repo module graph, so
      // this resolves to the same instance the repository logs through.
      const { logger } = await import("../../src/lib/logger.js");
      const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});

      const client = makeFakeClient((path) => {
        if (isSchema(path)) {
          // No "Dress"/"Dresses"/"Ready to Wear" — as if the option was renamed.
          return jsonResponse(
            inventoryDatabaseSchemaWithCategories(["Skate Soakers", "Other"]),
          );
        }
        throw new Error(`unexpected path ${path}`);
      });

      await repo.listCategories(client);

      expect(errorSpy).toHaveBeenCalledOnce();
      errorSpy.mockRestore();
    });

    it("does not log when the size-chart Item Type values are present", async () => {
      const { logger } = await import("../../src/lib/logger.js");
      const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});

      const client = makeFakeClient((path) => {
        if (isSchema(path)) {
          return jsonResponse(
            inventoryDatabaseSchemaWithCategories([
              "Dress",
              "Dresses",
              "Ready to Wear",
              "Skate Soakers",
            ]),
          );
        }
        throw new Error(`unexpected path ${path}`);
      });

      await repo.listCategories(client);

      expect(errorSpy).not.toHaveBeenCalled();
      errorSpy.mockRestore();
    });
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
        if (isSchema(path)) {
          return jsonResponse(inventoryDatabaseSchemaWithCategories(["Dress"]));
        }
        throw new Error(`unexpected path ${path}`);
      });

      await repo.listCategories(client);
      await repo.listCategories(client); // within TTL → cached
      let schemaFetches = client.calls.filter((c) => isSchema(c.path)).length;
      expect(schemaFetches).toBe(1);

      vi.advanceTimersByTime(61_000);
      await repo.listCategories(client);
      schemaFetches = client.calls.filter((c) => isSchema(c.path)).length;
      expect(schemaFetches).toBe(2);
    });

    it("falls back to the cached categories when a later fetch fails", async () => {
      let failSchema = false;
      const client = makeFakeClient((path) => {
        if (!isSchema(path)) throw new Error(`unexpected path ${path}`);
        return failSchema
          ? errorResponse(503)
          : jsonResponse(inventoryDatabaseSchemaWithCategories(["Dress"]));
      });

      const first = await repo.listCategories(client);
      expect(first).toEqual(["Dress"]);

      failSchema = true;
      vi.advanceTimersByTime(61_000);
      const second = await repo.listCategories(client);
      expect(second).toEqual(["Dress"]); // served from cache, not thrown
    });
  });
});
