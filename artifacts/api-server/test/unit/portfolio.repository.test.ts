import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  makeFakeClient,
  jsonResponse,
  errorResponse,
  portfolioPage,
  portfolioDatabaseSchemaWithCategories,
} from "../support/fake-notion.js";

// The repository keeps two module-level TTL caches (items + categories), so each
// test imports a fresh copy of the module to start from a clean cache — same
// approach as products.repository.test.ts.
let repo: typeof import("../../src/lib/notion/portfolio.repository.js");

beforeEach(async () => {
  vi.resetModules();
  repo = await import("../../src/lib/notion/portfolio.repository.js");
});

const isQuery = (path: string) => path.endsWith("/query");
const isSchema = (path: string) => /\/v1\/databases\/[^/]+$/.test(path);

function queryResponse(
  results: unknown[],
  { hasMore = false, nextCursor = null as string | null } = {},
) {
  return jsonResponse({ results, has_more: hasMore, next_cursor: nextCursor });
}

describe("listPortfolioItems", () => {
  it("throws when the database id is not configured", async () => {
    const client = makeFakeClient(() => jsonResponse({}), "");
    await expect(repo.listPortfolioItems(client)).rejects.toThrow(
      /NOTION_PORTFOLIO_DATABASE_ID is not configured/,
    );
  });

  it("queries with the publish-checkbox filter and maps the pages", async () => {
    const client = makeFakeClient((path) => {
      if (isQuery(path)) {
        return queryResponse([
          portfolioPage({
            id: "i1",
            title: "Aurora Dress",
            category: "Dresses",
            photos: ["https://img/a.jpg"],
          }),
        ]);
      }
      throw new Error(`unexpected path ${path}`);
    });

    const items = await repo.listPortfolioItems(client);

    expect(items).toEqual([
      {
        id: "i1",
        title: "Aurora Dress",
        category: "Dresses",
        photos: ["https://img/a.jpg"],
      },
    ]);
    // The query body carries the publish-checkbox filter.
    const body = JSON.parse(client.calls[0].init?.body as string);
    expect(body.filter).toEqual({
      property: "Show on website",
      checkbox: { equals: true },
    });
  });

  it("paginates across cursors", async () => {
    let call = 0;
    const client = makeFakeClient((path) => {
      if (isQuery(path)) {
        call += 1;
        return call === 1
          ? queryResponse([portfolioPage({ id: "i1", title: "One" })], {
              hasMore: true,
              nextCursor: "cur",
            })
          : queryResponse([portfolioPage({ id: "i2", title: "Two" })]);
      }
      throw new Error(`unexpected path ${path}`);
    });

    const items = await repo.listPortfolioItems(client);
    expect(items.map((i) => i.id)).toEqual(["i1", "i2"]);
  });

  it("falls back to the cached list when a later query fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    let fail = false;
    const client = makeFakeClient((path) => {
      if (isQuery(path)) {
        return fail
          ? errorResponse(500)
          : queryResponse([portfolioPage({ id: "i1", title: "One" })]);
      }
      throw new Error(`unexpected path ${path}`);
    });

    const first = await repo.listPortfolioItems(client);
    expect(first.map((i) => i.id)).toEqual(["i1"]);

    // The query now fails, but the cache is still usable after TTL expiry.
    fail = true;
    vi.advanceTimersByTime(61_000);
    const second = await repo.listPortfolioItems(client);
    expect(second.map((i) => i.id)).toEqual(["i1"]);

    vi.useRealTimers();
  });
});

describe("listCategories", () => {
  it("reads the live Category options from the database schema", async () => {
    const client = makeFakeClient((path) => {
      if (isSchema(path)) {
        return jsonResponse(
          portfolioDatabaseSchemaWithCategories(["Dresses", "Leotards"]),
        );
      }
      throw new Error(`unexpected path ${path}`);
    });

    expect(await repo.listCategories(client)).toEqual(["Dresses", "Leotards"]);
  });
});
