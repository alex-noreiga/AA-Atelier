import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  makeFakeClient,
  jsonResponse,
  errorResponse,
  fabricPage,
} from "../support/fake-notion.js";

// Module-level TTL cache, so re-import the module fresh per test — same approach
// as product-categories.repository.test.ts.
let repo: typeof import("../../src/lib/notion/fabrics.repository.js");

beforeEach(async () => {
  vi.resetModules();
  repo = await import("../../src/lib/notion/fabrics.repository.js");
});

function queryResponse(
  results: unknown[],
  { hasMore = false, nextCursor = null as string | null } = {},
) {
  return jsonResponse({ results, has_more: hasMore, next_cursor: nextCursor });
}

const ivory = () =>
  fabricPage({
    id: "f-ivory",
    name: "Ivory",
    type: "Solid",
    placement: "Both",
    hex: "#F4EFE6",
    sort: 1,
  });

describe("listFabricRecords", () => {
  it("returns [] when the database is not configured (empty id)", async () => {
    const client = makeFakeClient(() => jsonResponse({}), "");
    expect(await repo.listFabricRecords(client)).toEqual([]);
    // Must not have made a network call.
    expect(client.calls).toHaveLength(0);
  });

  it("queries filtered on the publish checkbox and maps the rows", async () => {
    const client = makeFakeClient((path, init) => {
      if (!path.endsWith("/query")) throw new Error(`unexpected path ${path}`);
      // The query filters to published rows only.
      const body = JSON.parse(init!.body as string);
      expect(body.filter).toEqual({
        property: "Show on website",
        checkbox: { equals: true },
      });
      return queryResponse([ivory()]);
    });

    expect(await repo.listFabricRecords(client)).toEqual([
      {
        id: "f-ivory",
        name: "Ivory",
        type: "solid",
        placement: "both",
        hex: "#F4EFE6",
        sort: 1,
      },
    ]);
  });

  it("paginates through has_more / next_cursor", async () => {
    const client = makeFakeClient((path, init) => {
      if (!path.endsWith("/query")) throw new Error(`unexpected path ${path}`);
      const cursor = JSON.parse(init!.body as string).start_cursor ?? null;
      if (cursor === null) {
        return queryResponse(
          [
            fabricPage({
              id: "f1",
              name: "Ivory",
              type: "Solid",
              placement: "Both",
            }),
          ],
          { hasMore: true, nextCursor: "cursor-2" },
        );
      }
      return queryResponse([
        fabricPage({
          id: "f2",
          name: "Black",
          type: "Solid",
          placement: "Bodice",
        }),
      ]);
    });

    const records = await repo.listFabricRecords(client);
    expect(records.map((r) => r.id)).toEqual(["f1", "f2"]);
    expect(client.calls.filter((c) => c.path.endsWith("/query"))).toHaveLength(
      2,
    );
  });

  it("throws with the status when the query response is not ok", async () => {
    const client = makeFakeClient(() => errorResponse(503));
    await expect(repo.listFabricRecords(client)).rejects.toThrow(
      /Notion Fabrics query failed with status 503/,
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
        if (path.endsWith("/query")) return queryResponse([ivory()]);
        throw new Error(`unexpected path ${path}`);
      });

      await repo.listFabricRecords(client);
      await repo.listFabricRecords(client); // within TTL → cached
      expect(client.calls.length).toBe(1);

      vi.advanceTimersByTime(61_000);
      await repo.listFabricRecords(client);
      expect(client.calls.length).toBe(2);
    });

    it("falls back to the cached records when a later fetch fails", async () => {
      let fail = false;
      const client = makeFakeClient((path) => {
        if (!path.endsWith("/query"))
          throw new Error(`unexpected path ${path}`);
        return fail ? errorResponse(503) : queryResponse([ivory()]);
      });

      const first = await repo.listFabricRecords(client);
      expect(first.map((r) => r.id)).toEqual(["f-ivory"]);

      fail = true;
      vi.advanceTimersByTime(61_000);
      // Served from cache rather than throwing — a Notion blip must not empty
      // the picker.
      const second = await repo.listFabricRecords(client);
      expect(second.map((r) => r.id)).toEqual(["f-ivory"]);
    });
  });
});
