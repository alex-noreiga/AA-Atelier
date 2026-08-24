import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  listPublishedPortfolioPieces,
  portfolioConfigured,
  __resetPortfolioCache,
} from "../../src/lib/notion/portfolio.repository.js";
import { makeFakeClient, jsonResponse } from "../support/fake-notion.js";

function page(id: string, published = true) {
  return {
    id,
    created_time: "2026-06-01T00:00:00.000Z",
    properties: {
      Name: { type: "title", title: [{ plain_text: id }] },
      "Image / Sketch": {
        type: "files",
        files: [
          { type: "file", file: { url: `https://notion.test/${id}.png` } },
        ],
      },
      "Show on website": { type: "checkbox", checkbox: published },
    },
  };
}

/** Notion's 404 body — an id that's wrong, or a database never shared. */
function notFound(): Response {
  return new Response(
    JSON.stringify({ object: "error", code: "object_not_found", message: "…" }),
    { status: 404, headers: { "Content-Type": "application/json" } },
  );
}

beforeEach(() => {
  __resetPortfolioCache();
});

describe("portfolioConfigured", () => {
  it("is false when the portfolio database id is unset", () => {
    expect(
      portfolioConfigured(makeFakeClient(() => jsonResponse({}), "")),
    ).toBe(false);
  });

  it("is true once a database id is configured", () => {
    expect(portfolioConfigured(makeFakeClient(() => jsonResponse({})))).toBe(
      true,
    );
  });
});

describe("listPublishedPortfolioPieces", () => {
  it("serves the published rows and withholds the rest", async () => {
    const client = makeFakeClient(() =>
      jsonResponse({ results: [page("shown"), page("hidden", false)] }),
    );

    const pieces = await listPublishedPortfolioPieces(client);

    expect(pieces.map((p) => p.id)).toEqual(["shown"]);
  });

  it("scans rather than filtering, so a database without the publish column can't 400", async () => {
    const client = makeFakeClient(() => jsonResponse({ results: [page("a")] }));

    await listPublishedPortfolioPieces(client);

    const body = JSON.parse(String(client.calls[0]!.init!.body)) as Record<
      string,
      unknown
    >;
    expect(body).not.toHaveProperty("filter");
  });

  it("returns an empty gallery — and never calls Notion — when unconfigured", async () => {
    const client = makeFakeClient(() => jsonResponse({ results: [] }), "");

    expect(await listPublishedPortfolioPieces(client)).toEqual([]);
    expect(client.calls).toHaveLength(0);
  });

  it("degrades a Notion 404 to an empty gallery instead of erroring the page", async () => {
    const client = makeFakeClient(() => notFound());

    expect(await listPublishedPortfolioPieces(client)).toEqual([]);
  });

  it("does not cache that 404, so sharing the database takes effect at once", async () => {
    let fail = true;
    const client = makeFakeClient(() =>
      fail ? notFound() : jsonResponse({ results: [page("a")] }),
    );

    expect(await listPublishedPortfolioPieces(client)).toEqual([]);
    fail = false;
    expect(await listPublishedPortfolioPieces(client)).toHaveLength(1);
  });

  it("rethrows any other Notion status — an outage clears itself and is worth an alert", async () => {
    const client = makeFakeClient(() => new Response("boom", { status: 502 }));

    await expect(listPublishedPortfolioPieces(client)).rejects.toThrow(
      /status 502/,
    );
  });

  it("caches the scan within the TTL", async () => {
    const client = makeFakeClient(() => jsonResponse({ results: [page("a")] }));

    await listPublishedPortfolioPieces(client);
    await listPublishedPortfolioPieces(client);

    expect(client.calls).toHaveLength(1);
  });

  it("falls back to the cached gallery when a later read fails", async () => {
    let fail = false;
    const client = makeFakeClient(() =>
      fail
        ? new Response("boom", { status: 502 })
        : jsonResponse({ results: [page("a")] }),
    );

    vi.useFakeTimers();
    try {
      await listPublishedPortfolioPieces(client);
      // Past the 60s TTL, so the second call genuinely re-reads and fails.
      vi.setSystemTime(new Date(Date.now() + 61_000));
      fail = true;

      expect(await listPublishedPortfolioPieces(client)).toHaveLength(1);
      expect(client.calls).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("follows Notion's cursor across pages", async () => {
    let call = 0;
    const client = makeFakeClient(() =>
      call++ === 0
        ? jsonResponse({
            results: [page("a")],
            has_more: true,
            next_cursor: "cursor-1",
          })
        : jsonResponse({ results: [page("b")], has_more: false }),
    );

    expect(await listPublishedPortfolioPieces(client)).toHaveLength(2);
    expect(client.calls).toHaveLength(2);
  });
});
