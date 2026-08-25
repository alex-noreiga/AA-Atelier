import { describe, it, expect, vi } from "vitest";
import type { Response } from "express";
import { setEdgeCache } from "../../src/lib/edge-cache.js";

/** A response stub that records what was set, in order. */
function fakeRes(): { res: Response; set: ReturnType<typeof vi.fn> } {
  const set = vi.fn();
  return { res: { set } as unknown as Response, set };
}

describe("setEdgeCache", () => {
  it("sends the directives to the browser and to the CDN", () => {
    const { res, set } = fakeRes();

    setEdgeCache(res, "public, s-maxage=120, stale-while-revalidate=600");

    expect(set).toHaveBeenCalledWith(
      "Cache-Control",
      "public, s-maxage=120, stale-while-revalidate=600",
    );
    // The one Vercel reads. `Cache-Control` alone stopped being enough on
    // 2026-08-25, when the platform began consuming the CDN directives out of
    // it — see the header comment on lib/edge-cache.ts.
    expect(set).toHaveBeenCalledWith(
      "CDN-Cache-Control",
      "public, s-maxage=120, stale-while-revalidate=600",
    );
  });

  it("never lets the two headers disagree about the age", () => {
    // The whole reason this is one function taking one argument. Two headers
    // maintained separately would drift, and the drift would be invisible from
    // outside a deploy — `CDN-Cache-Control` is consumed at the edge and never
    // reaches a client that could report it.
    const { res, set } = fakeRes();

    setEdgeCache(res, "public, s-maxage=3600, stale-while-revalidate=86400");

    const values = set.mock.calls.map(([, value]) => value);
    expect(new Set(values).size).toBe(1);
    expect(set.mock.calls.map(([name]) => name).sort()).toEqual([
      "CDN-Cache-Control",
      "Cache-Control",
    ]);
  });

  it("sets nothing else", () => {
    const { res, set } = fakeRes();

    setEdgeCache(res, "public, s-maxage=60");

    expect(set).toHaveBeenCalledTimes(2);
  });
});
