import { describe, it, expect } from "vitest";
import {
  attachShoppablePieces,
  indexShoppablePosts,
} from "../../src/services/instagram.service.js";
import type { VariantRecord } from "../../src/lib/notion/products.schema.js";
import type { InstagramPostRecord } from "../../src/lib/instagram/schema.js";

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

function post(
  overrides: Partial<InstagramPostRecord> = {},
): InstagramPostRecord {
  return {
    id: "media-1",
    permalink: "https://www.instagram.com/p/AAA111/",
    imageUrl: "https://cdn.test/a.jpg",
    mediaType: "image",
    ...overrides,
  };
}

describe("indexShoppablePosts", () => {
  it("keys a piece by the shortcode of the post the atelier recorded", () => {
    const index = indexShoppablePosts([
      variant({
        instagramPostUrl: "https://www.instagram.com/p/AAA111/?igsh=x",
      }),
    ]);

    expect(index.get("AAA111")).toEqual({
      productId: "row-1",
      productTitle: "Aurora Soaker",
    });
  });

  it("links to the shop CARD but labels with the row's own name", () => {
    // A grouped card is titled with the group ("Skate Soakers"), while the post
    // shows one particular colourway — so the link and the label come from
    // different places on purpose.
    const index = indexShoppablePosts([
      variant({
        group: "Skate Soakers",
        name: "Aurora Soaker",
        instagramPostUrl: "https://www.instagram.com/p/AAA111/",
      }),
    ]);

    expect(index.get("AAA111")).toEqual({
      productId: "group-skate-soakers",
      productTitle: "Aurora Soaker",
    });
  });

  it("ignores a row with no post, or one that names no post", () => {
    const index = indexShoppablePosts([
      variant({ id: "a", instagramPostUrl: "" }),
      variant({
        id: "b",
        instagramPostUrl: "https://www.instagram.com/a3ice/",
      }),
      variant({ id: "c", instagramPostUrl: "https://example.test/nope" }),
    ]);
    expect(index.size).toBe(0);
  });

  it("keeps the first row when two name the same post", () => {
    // A group photograph legitimately shows several pieces and there is one
    // link to give; first-wins keeps the answer stable across reads.
    const index = indexShoppablePosts([
      variant({
        id: "first",
        name: "First",
        instagramPostUrl: "https://www.instagram.com/p/AAA111/",
      }),
      variant({
        id: "second",
        name: "Second",
        instagramPostUrl: "https://www.instagram.com/reel/AAA111/",
      }),
    ]);
    expect(index.get("AAA111")).toEqual({
      productId: "first",
      productTitle: "First",
    });
  });

  it("keeps a sold-out piece, which still has a card to send someone to", () => {
    const index = indexShoppablePosts([
      variant({
        available: false,
        instagramPostUrl: "https://www.instagram.com/p/AAA111/",
      }),
    ]);
    expect(index.get("AAA111")?.productId).toBe("row-1");
  });
});

describe("attachShoppablePieces", () => {
  const index = indexShoppablePosts([
    variant({ instagramPostUrl: "https://www.instagram.com/p/AAA111/" }),
  ]);

  it("attaches the piece to the post that shows it", () => {
    const [linked] = attachShoppablePieces([post()], index);
    expect(linked).toMatchObject({
      id: "media-1",
      productId: "row-1",
      productTitle: "Aurora Soaker",
    });
  });

  it("leaves an unmatched post alone rather than guessing", () => {
    const [plain] = attachShoppablePieces(
      [post({ permalink: "https://www.instagram.com/p/ZZZ999/" })],
      index,
    );
    expect(plain).not.toHaveProperty("productId");
    expect(plain).not.toHaveProperty("productTitle");
  });

  it("serves every post unlinked when the shop could not be read", () => {
    // The posts are the feature and the shop link is the upsell: an inventory
    // failure costs the upsell, never the section.
    const posts = attachShoppablePieces([post()], new Map());
    expect(posts).toHaveLength(1);
    expect(posts[0]).not.toHaveProperty("productId");
  });
});
