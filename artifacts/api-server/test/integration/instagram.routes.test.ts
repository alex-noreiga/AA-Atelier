import { describe, it, expect, vi } from "vitest";

// Mock the two reads; the HTTP stack (routing → service → response schema parse
// → error handler) runs for real.
vi.mock("../../src/lib/instagram/media.repository.js", () => ({
  listInstagramPosts: vi.fn(),
}));
vi.mock("../../src/lib/notion/products.repository.js", () => ({
  listVariants: vi.fn(),
}));

import request from "supertest";
import app from "../../src/app.js";
import { listInstagramPosts } from "../../src/lib/instagram/media.repository.js";
import { listVariants } from "../../src/lib/notion/products.repository.js";
import type { VariantRecord } from "../../src/lib/notion/products.schema.js";

const mockPosts = vi.mocked(listInstagramPosts);
const mockVariants = vi.mocked(listVariants);

const POST = {
  id: "media-1",
  permalink: "https://www.instagram.com/p/AAA111/",
  imageUrl: "https://cdn.test/a.jpg",
  mediaType: "image" as const,
  caption: "A finished dress",
  postedAt: "2026-08-01T10:00:00.000Z",
};

function variant(overrides: Partial<VariantRecord> = {}): VariantRecord {
  return {
    id: "row-1",
    name: "Aurora Soaker",
    available: true,
    photos: [],
    sizes: [],
    addOnIds: [],
    category: "Skate Soakers",
    group: null,
    instagramPostUrl: "",
    ...overrides,
  };
}

describe("GET /api/instagram", () => {
  it("returns the studio's posts", async () => {
    mockPosts.mockResolvedValue([POST]);
    mockVariants.mockResolvedValue([]);

    const res = await request(app).get("/api/instagram");

    expect(res.status).toBe(200);
    expect(res.body.posts).toHaveLength(1);
    expect(res.body.posts[0]).toMatchObject({
      id: "media-1",
      permalink: "https://www.instagram.com/p/AAA111/",
      imageUrl: "https://cdn.test/a.jpg",
      mediaType: "image",
      caption: "A finished dress",
    });
    expect(res.body.posts[0]).not.toHaveProperty("productId");
  });

  it("carries the shop piece for a post the atelier tied to one", async () => {
    mockPosts.mockResolvedValue([POST]);
    mockVariants.mockResolvedValue([
      variant({ instagramPostUrl: "https://www.instagram.com/p/AAA111/" }),
    ]);

    const res = await request(app).get("/api/instagram");

    expect(res.body.posts[0]).toMatchObject({
      productId: "row-1",
      productTitle: "Aurora Soaker",
    });
  });

  it("serves the feed unlinked when inventory cannot be read", async () => {
    // The posts are the feature; the shop link is the upsell. A Notion outage
    // must cost the upsell, never the section — and never a 500 on the home page.
    mockPosts.mockResolvedValue([POST]);
    mockVariants.mockRejectedValue(new Error("Notion is down"));

    const res = await request(app).get("/api/instagram");

    expect(res.status).toBe(200);
    expect(res.body.posts).toHaveLength(1);
    expect(res.body.posts[0]).not.toHaveProperty("productId");
  });

  it("returns an empty feed when Instagram is unconfigured or unreadable", async () => {
    mockPosts.mockResolvedValue([]);

    const res = await request(app).get("/api/instagram");

    expect(res.status).toBe(200);
    expect(res.body.posts).toEqual([]);
    // Nothing is asked of Notion when there is no post to link.
    expect(mockVariants).not.toHaveBeenCalled();
  });

  it("declares the same edge cache to the CDN and to everyone else", async () => {
    // The two headers are written from one argument in `setEdgeCache` so they
    // can't drift; `s-maxage` is pinned here because it is not observable in
    // production, where the directives are rewritten at the edge.
    mockPosts.mockResolvedValue([]);

    const res = await request(app).get("/api/instagram");

    expect(res.headers["cache-control"]).toContain("s-maxage=600");
    expect(res.headers["cdn-cache-control"]).toBe(res.headers["cache-control"]);
  });
});
