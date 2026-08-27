import { describe, it, expect } from "vitest";
import {
  extractInstagramPosts,
  instagramShortcode,
  mediaKind,
  stillUrl,
} from "../../src/lib/instagram/schema.js";

describe("mediaKind", () => {
  it("maps Instagram's own vocabulary to the contract's", () => {
    expect(mediaKind("IMAGE")).toBe("image");
    expect(mediaKind("VIDEO")).toBe("video");
    expect(mediaKind("CAROUSEL_ALBUM")).toBe("carousel");
  });

  it("reads an unknown or missing type as an image rather than dropping it", () => {
    // A fourth media kind should widen the strip, not silently empty it — every
    // post carries a still whatever Instagram calls it.
    expect(mediaKind("REELS")).toBe("image");
    expect(mediaKind(undefined)).toBe("image");
    expect(mediaKind(42)).toBe("image");
  });
});

describe("stillUrl", () => {
  it("prefers the poster frame for a video", () => {
    // media_url on a video is the MP4: rendering it in an <img> is a blank
    // tile, not an error, which is exactly the failure worth pinning.
    expect(
      stillUrl({
        media_type: "VIDEO",
        media_url: "https://cdn.test/clip.mp4",
        thumbnail_url: "https://cdn.test/poster.jpg",
      }),
    ).toBe("https://cdn.test/poster.jpg");
  });

  it("falls back to the media url when a video has no poster", () => {
    expect(
      stillUrl({ media_type: "VIDEO", media_url: "https://cdn.test/clip.mp4" }),
    ).toBe("https://cdn.test/clip.mp4");
  });

  it("uses the media url for a photo or a carousel", () => {
    expect(
      stillUrl({ media_type: "IMAGE", media_url: "https://cdn.test/a.jpg" }),
    ).toBe("https://cdn.test/a.jpg");
    expect(
      stillUrl({
        media_type: "CAROUSEL_ALBUM",
        media_url: "https://cdn.test/first.jpg",
      }),
    ).toBe("https://cdn.test/first.jpg");
  });
});

describe("extractInstagramPosts", () => {
  const node = {
    id: "1",
    permalink: "https://www.instagram.com/p/ABC123/",
    media_type: "IMAGE",
    media_url: "https://cdn.test/a.jpg",
    caption: "  A finished dress  ",
    timestamp: "2026-08-01T10:00:00+0000",
  };

  it("maps a media list, trimming and preserving order", () => {
    const posts = extractInstagramPosts({
      data: [node, { ...node, id: "2", media_url: "https://cdn.test/b.jpg" }],
    });

    expect(posts.map((p) => p.id)).toEqual(["1", "2"]);
    expect(posts[0]).toEqual({
      id: "1",
      permalink: "https://www.instagram.com/p/ABC123/",
      imageUrl: "https://cdn.test/a.jpg",
      mediaType: "image",
      caption: "A finished dress",
      postedAt: "2026-08-01T10:00:00+0000",
    });
  });

  it("omits an absent caption and timestamp rather than sending them empty", () => {
    const [post] = extractInstagramPosts({
      data: [{ ...node, caption: "   ", timestamp: undefined }],
    });
    expect(post).not.toHaveProperty("caption");
    expect(post).not.toHaveProperty("postedAt");
  });

  it("drops a node with no id, permalink or usable still", () => {
    // Each of these renders as a tile the visitor can see is broken — no key,
    // nowhere to click, or an empty square. One tile shorter beats one broken.
    const posts = extractInstagramPosts({
      data: [
        { ...node, id: "" },
        { ...node, permalink: "" },
        { ...node, media_url: "", thumbnail_url: "" },
        node,
      ],
    });
    expect(posts.map((p) => p.id)).toEqual(["1"]);
  });

  it("treats a missing or non-array payload as no posts", () => {
    expect(extractInstagramPosts({})).toEqual([]);
    expect(extractInstagramPosts({ data: "nope" })).toEqual([]);
  });
});

describe("instagramShortcode", () => {
  it("reads the same code from every address Instagram serves a post under", () => {
    // The point of keying on the shortcode: which of these the atelier happens
    // to copy must not decide whether the join works.
    const forms = [
      "https://www.instagram.com/p/DGh1abc_XY/",
      "https://instagram.com/p/DGh1abc_XY",
      "https://www.instagram.com/reel/DGh1abc_XY/?igsh=Zm9vYmFy",
      "https://www.instagram.com/reels/DGh1abc_XY/",
      "https://www.instagram.com/tv/DGh1abc_XY/",
      "https://www.instagram.com/a3iceanddance/p/DGh1abc_XY/",
      "  https://www.instagram.com/p/DGh1abc_XY/  ",
    ];
    for (const url of forms) {
      expect(instagramShortcode(url)).toBe("DGh1abc_XY");
    }
  });

  it("yields null for anything that isn't a post URL", () => {
    expect(instagramShortcode("")).toBeNull();
    expect(
      instagramShortcode("https://www.instagram.com/a3iceanddance/"),
    ).toBeNull();
    expect(instagramShortcode("not a url")).toBeNull();
  });
});
