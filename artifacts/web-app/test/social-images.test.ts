import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { imageSize } from "./support/image-size";
import path from "node:path";
import {
  DEFAULT_OG_IMAGES,
  INDEXABLE_ROUTES,
  SITE_ORIGIN,
  imagesFor,
  socialSlug,
  type OgImage,
} from "@/lib/seo-routes";

/**
 * Guards the seam between the metadata and the artwork.
 *
 * `seo-routes.ts` derives every indexable route's share-image URLs from its
 * path, but the files themselves are produced out-of-band by
 * `scripts/generate-social-images.ts`. Nothing at build time checks that the
 * two agree, so a route added without regenerating the art would ship an
 * `og:image` pointing at a 404 — invisible until a share card came up blank
 * weeks later. These tests fail the build instead.
 */

const PUBLIC_DIR = path.resolve(import.meta.dirname, "../public");

/** Map an absolute site URL back to the file that serves it. */
function localFile(url: string): string {
  expect(url.startsWith(`${SITE_ORIGIN}/`)).toBe(true);
  return path.join(PUBLIC_DIR, url.slice(SITE_ORIGIN.length));
}

function expectServed(image: OgImage) {
  const file = localFile(image.url);
  expect(fs.existsSync(file), `${image.url} has no file at ${file}`).toBe(true);

  if (image.width !== undefined && image.height !== undefined) {
    // A declared size that doesn't match the file makes scrapers reserve the
    // wrong aspect ratio, which is the whole bug this metadata exists to avoid.
    expect(imageSize(file), `${image.url} dimensions`).toEqual({
      width: image.width,
      height: image.height,
    });
  }
}

describe("generated social artwork", () => {
  it.each(INDEXABLE_ROUTES.map((r) => [r.path, r] as const))(
    "%s ships both share formats at their declared sizes",
    (_path, route) => {
      const images = imagesFor(route);

      expect(images.map((i) => i.url)).toEqual([
        `${SITE_ORIGIN}/social/${socialSlug(route.path)}-og.png`,
        `${SITE_ORIGIN}/social/${socialSlug(route.path)}-pin.png`,
      ]);
      // Landscape first (Facebook, LinkedIn, Slack take the primary image),
      // then the 2:3 vertical Pinterest renders well.
      expect(images[0]).toMatchObject({ width: 1200, height: 630 });
      expect(images[1]).toMatchObject({ width: 1000, height: 1500 });
      images.forEach(expectServed);
    },
  );

  it("serves every image in the fallback set", () => {
    DEFAULT_OG_IMAGES.forEach(expectServed);
  });

  it("gives a noindex route the fallback set, not art it has no files for", () => {
    expect(
      imagesFor({ path: "/track", title: "Track", noindex: true }),
    ).toEqual(DEFAULT_OG_IMAGES);
  });

  it("lets an explicit image win over a route's generated art", () => {
    const own = [{ url: "https://notion.test/dress.jpg", alt: "a dress" }];

    expect(imagesFor({ path: "/shop", title: "Shop", images: own })).toEqual(
      own,
    );
  });
});

describe("socialSlug", () => {
  it("names the home route and flattens nested paths", () => {
    expect(socialSlug("/")).toBe("home");
    expect(socialSlug("/about")).toBe("about");
    expect(socialSlug("/shipping-returns")).toBe("shipping-returns");
    expect(socialSlug("/shop/success")).toBe("shop-success");
  });
});
