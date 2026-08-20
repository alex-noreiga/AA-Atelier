import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { renderRouteHtml } from "@/lib/seo-html";
import { INDEXABLE_ROUTES } from "@/lib/seo-routes";
import { icoSizes, imageSize } from "./support/image-size";

/**
 * Guards the site icons.
 *
 * Every page's icon markup comes from one place — the `<link rel="icon">` block
 * in `index.html` — which the prerenderer copies verbatim into each route's
 * static file and which the SPA fallback serves for everything else. So "the
 * right favicon on every route" reduces to two claims worth checking: the block
 * survives prerendering, and each file it points at exists at the size it is
 * declared to be. A `sizes=` attribute is a claim the browser trusts without
 * verifying, so a wrong one silently picks the wrong icon.
 */

const ROOT = path.resolve(import.meta.dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const TEMPLATE = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

interface IconLink {
  rel: string;
  href: string;
  sizes?: string;
}

/** Every icon-ish <link> in the document head. */
function iconLinks(html: string): IconLink[] {
  const links = html.match(/<link\b[^>]*>/g) ?? [];
  return links
    .map((tag) => ({
      rel: /rel="([^"]+)"/.exec(tag)?.[1] ?? "",
      href: /href="([^"]+)"/.exec(tag)?.[1] ?? "",
      sizes: /sizes="([^"]+)"/.exec(tag)?.[1],
    }))
    .filter((l) => l.rel === "icon" || l.rel === "apple-touch-icon");
}

const TEMPLATE_ICONS = iconLinks(TEMPLATE);

function localFile(href: string): string {
  // Root-absolute hrefs are what make one icon block work at every route depth;
  // a relative href would resolve against /shop/<id>/ and 404.
  expect(href.startsWith("/"), `${href} must be root-absolute`).toBe(true);
  return path.join(PUBLIC_DIR, href);
}

describe("site icons", () => {
  it("declares the icon set index.html is expected to ship", () => {
    expect(TEMPLATE_ICONS).toEqual([
      { rel: "icon", href: "/favicon.ico", sizes: "any" },
      { rel: "icon", href: "/favicon-192.png", sizes: "192x192" },
      { rel: "icon", href: "/favicon-32.png", sizes: "32x32" },
      { rel: "icon", href: "/favicon-16.png", sizes: "16x16" },
      {
        rel: "apple-touch-icon",
        href: "/apple-touch-icon.png",
        sizes: "180x180",
      },
    ]);
  });

  it.each(TEMPLATE_ICONS.map((l) => [l.href, l] as const))(
    "%s exists and is really the size it claims",
    (_href, link) => {
      const file = localFile(link.href);
      expect(fs.existsSync(file), `${link.href} has no file at ${file}`).toBe(
        true,
      );

      if (link.sizes && link.sizes !== "any") {
        const [width, height] = link.sizes.split("x").map(Number);
        expect(imageSize(file), `${link.href} dimensions`).toEqual({
          width,
          height,
        });
      }
    },
  );

  it("ships an .ico carrying the classic small raster sizes", () => {
    // `sizes="any"` waives a specific claim, but an .ico with no 16px entry is
    // scaled down by the browser and turns to mush in the tab strip.
    const sizes = icoSizes(
      fs.readFileSync(path.join(PUBLIC_DIR, "favicon.ico")),
    );

    expect(sizes.length).toBeGreaterThan(0);
    expect(sizes.map((s) => s.width)).toContain(16);
    expect(sizes.every((s) => s.width === s.height)).toBe(true);
  });
});

describe("web app manifest", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(PUBLIC_DIR, "site.webmanifest"), "utf8"),
  );

  it("is linked from the document head", () => {
    expect(TEMPLATE).toContain(
      '<link rel="manifest" href="/site.webmanifest" />',
    );
  });

  it("points every declared icon at a real file of that size", () => {
    expect(manifest.icons.length).toBeGreaterThan(0);
    for (const icon of manifest.icons) {
      const file = localFile(icon.src);
      expect(fs.existsSync(file), `${icon.src} has no file`).toBe(true);

      const [width, height] = icon.sizes.split("x").map(Number);
      expect(imageSize(file), `${icon.src} dimensions`).toEqual({
        width,
        height,
      });
    }
  });

  it("marks the large icon maskable so Android does not letterbox it", () => {
    // Safe only because the mark is full-bleed on an opaque background and its
    // glyph stays inside the centred 80%-width safe circle; a transparent or
    // edge-to-edge icon declared maskable gets cropped into.
    const large = manifest.icons.find(
      (i: { sizes: string }) => i.sizes === "512x512",
    );

    expect(large.purpose).toContain("maskable");
  });

  it("matches the theme colour the document head declares", () => {
    expect(TEMPLATE).toContain(
      `<meta name="theme-color" content="${manifest.theme_color}" />`,
    );
  });
});

describe("prerendered routes", () => {
  it.each(INDEXABLE_ROUTES.map((r) => [r.path, r] as const))(
    "%s keeps the full icon set through prerendering",
    (_path, route) => {
      // The prerenderer rewrites the head with regexes; this proves none of them
      // eats the icon links on the way past.
      expect(iconLinks(renderRouteHtml(TEMPLATE, route))).toEqual(
        TEMPLATE_ICONS,
      );
      expect(renderRouteHtml(TEMPLATE, route)).toContain(
        'rel="manifest" href="/site.webmanifest"',
      );
    },
  );

  it("keeps the icon set on a prerendered product page", () => {
    // Product pages take the same template but a different code path (they also
    // inject JSON-LD), so they are worth asserting separately.
    const html = renderRouteHtml(
      TEMPLATE,
      {
        path: "/shop/abc-123",
        title: "Aurora Dress | The Shop | A.A Atelier",
        description: "A dress.",
      },
      [{ "@type": "Product", name: "Aurora Dress" }],
    );

    expect(iconLinks(html)).toEqual(TEMPLATE_ICONS);
  });
});
