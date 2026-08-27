import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  listInstagramPosts,
  __resetInstagramMediaCache,
} from "../../src/lib/instagram/media.repository.js";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

const MEDIA = {
  data: [
    {
      id: "1",
      permalink: "https://www.instagram.com/p/AAA111/",
      media_type: "IMAGE",
      media_url: "https://cdn.test/a.jpg",
    },
  ],
};

describe("listInstagramPosts", () => {
  beforeEach(() => {
    __resetInstagramMediaCache();
  });

  it("returns nothing at all when Instagram is not configured", async () => {
    const fetchImpl = vi.fn();
    const posts = await listInstagramPosts({
      configured: () => false,
      fetchImpl,
    });
    expect(posts).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reads the studio's posts", async () => {
    const posts = await listInstagramPosts({
      configured: () => true,
      token: async () => "tok",
      fetchImpl: async () => jsonResponse(MEDIA),
    });
    expect(posts.map((p) => p.id)).toEqual(["1"]);
  });

  it("caches, so the strip on two pages is one call", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(MEDIA));
    const deps = {
      configured: () => true,
      token: async () => "tok",
      fetchImpl,
    };
    await listInstagramPosts(deps);
    await listInstagramPosts(deps);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("serves the stale list rather than an empty one when Instagram refuses", async () => {
    vi.useFakeTimers();
    try {
      await listInstagramPosts({
        configured: () => true,
        token: async () => "tok",
        fetchImpl: async () => jsonResponse(MEDIA),
      });
      // Past the cache TTL, so the second call really does go out.
      vi.advanceTimersByTime(10 * 60_000);

      // An expired token answers 401 here; the strip should not blink out while
      // the nightly refresh still has a fortnight of retries left.
      const posts = await listInstagramPosts({
        configured: () => true,
        token: async () => "tok",
        fetchImpl: async () => jsonResponse({}, false, 401),
      });
      expect(posts.map((p) => p.id)).toEqual(["1"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns an empty list — never throws — when the very first read fails", async () => {
    const posts = await listInstagramPosts({
      configured: () => true,
      token: async () => "tok",
      fetchImpl: async () => {
        throw new Error("network down");
      },
    });
    expect(posts).toEqual([]);
  });

  it("returns an empty list when no token could be resolved", async () => {
    const fetchImpl = vi.fn();
    const posts = await listInstagramPosts({
      configured: () => true,
      token: async () => "",
      fetchImpl,
    });
    expect(posts).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
