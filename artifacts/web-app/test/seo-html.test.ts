import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  canonicalFor,
  escapeJsonLd,
  injectStructuredData,
  renderImageBlock,
  renderRouteHtml,
  renderSitemap,
  replaceImageBlock,
  pinterestVerifyTag,
} from "@/lib/seo-html";
import { DEFAULT_OG_IMAGE, SITE_ORIGIN } from "@/lib/seo-routes";

/**
 * The real built template is `index.html` with Vite's asset rewriting applied;
 * the head tags this module edits are untouched by that, so the source file is
 * a faithful stand-in and keeps the test honest about the markers really being
 * present in the file that ships.
 */
const TEMPLATE = fs.readFileSync(
  path.resolve(import.meta.dirname, "../index.html"),
  "utf8",
);

const WIDE = {
  url: "https://x.test/wide.jpg",
  width: 1200,
  height: 630,
  alt: "wide",
};
const TALL = {
  url: "https://x.test/tall.jpg",
  width: 1000,
  height: 1500,
  alt: "tall",
};

describe("renderImageBlock", () => {
  it("keeps each image's dimensions attached to that image", () => {
    const block = renderImageBlock([WIDE, TALL]);

    expect(block).toBe(
      [
        '    <meta property="og:image" content="https://x.test/wide.jpg" />',
        '    <meta property="og:image:width" content="1200" />',
        '    <meta property="og:image:height" content="630" />',
        '    <meta property="og:image:alt" content="wide" />',
        '    <meta property="og:image" content="https://x.test/tall.jpg" />',
        '    <meta property="og:image:width" content="1000" />',
        '    <meta property="og:image:height" content="1500" />',
        '    <meta property="og:image:alt" content="tall" />',
        '    <meta name="twitter:image" content="https://x.test/wide.jpg" />',
        '    <meta name="twitter:image:alt" content="wide" />',
      ].join("\n"),
    );
  });

  it("omits dimension tags for an image of unknown size", () => {
    const block = renderImageBlock([{ url: "https://notion.test/p.jpg" }]);

    expect(block).not.toContain("og:image:width");
    expect(block).not.toContain("og:image:height");
    expect(block).toContain('content="https://notion.test/p.jpg"');
  });

  it("escapes quotes in an alt so the attribute cannot be broken out of", () => {
    const block = renderImageBlock([
      { url: "https://x.test/a.jpg", alt: 'a "quoted" dress' },
    ]);

    expect(block).toContain('content="a &quot;quoted&quot; dress"');
  });
});

describe("replaceImageBlock", () => {
  it("throws when index.html has lost its markers", () => {
    expect(() => replaceImageBlock("<head></head>", [WIDE])).toThrow(
      /seo:images:start/,
    );
  });

  it("replaces the block rather than appending to it", () => {
    const html = replaceImageBlock(TEMPLATE, [WIDE]);
    const count = html.match(/property="og:image"/g) ?? [];

    expect(count).toHaveLength(1);
    expect(html).toContain('content="https://x.test/wide.jpg"');
    // Scoped to meta tags: the static Organization JSON-LD also names the
    // default image, and that block is deliberately left untouched.
    expect(html).not.toMatch(/<meta[^>]*opengraph\.jpg/);
  });
});

describe("renderRouteHtml", () => {
  const route = {
    path: "/shop",
    title: "Shop | A.A Atelier",
    description: "Ready-to-wear pieces.",
  };

  it("writes the route's title, description, canonical, and og:url", () => {
    const html = renderRouteHtml(TEMPLATE, route);

    expect(html).toContain("<title>Shop | A.A Atelier</title>");
    expect(html).toContain(
      `<meta property="og:url" content="${SITE_ORIGIN}/shop" />`,
    );
    expect(html).toContain(`href="${SITE_ORIGIN}/shop"`);
    expect(html).toContain('content="Ready-to-wear pieces."');
  });

  it("bakes in the route's own generated pair when it sets no images", () => {
    const html = renderRouteHtml(TEMPLATE, route);

    expect(html).toContain(`content="${SITE_ORIGIN}/social/shop-og.png"`);
    expect(html).toContain(`content="${SITE_ORIGIN}/social/shop-pin.png"`);
    expect(html).toContain('<meta property="og:image:width" content="1200" />');
    expect(html).toContain('<meta property="og:image:width" content="1000" />');
  });

  it("falls back to the shared default set for a route with no art", () => {
    const html = renderRouteHtml(TEMPLATE, {
      ...route,
      path: "/track",
      noindex: true,
    });

    expect(html).toContain(`content="${DEFAULT_OG_IMAGE.url}"`);
  });

  it("does not leave the default image behind when a route overrides it", () => {
    const html = renderRouteHtml(TEMPLATE, { ...route, images: [TALL] });

    expect(html).not.toMatch(/<meta[^>]*opengraph\.jpg/);
    expect(html).toContain(
      '<meta property="og:image:height" content="1500" />',
    );
  });

  it("marks a noindex route noindex", () => {
    const html = renderRouteHtml(TEMPLATE, { ...route, noindex: true });

    expect(html).toContain('content="noindex, follow"');
  });

  it("escapes an ampersand in the title as HTML text and as an attribute", () => {
    const html = renderRouteHtml(TEMPLATE, {
      ...route,
      title: "Skating & Dance",
    });

    expect(html).toContain("<title>Skating &amp; Dance</title>");
    // og:title is a multi-line tag in index.html, so assert on the value alone.
    expect(html).toContain('content="Skating &amp; Dance"');
  });
});

describe("injectStructuredData", () => {
  it("injects a JSON-LD block at the marker", () => {
    const html = injectStructuredData(TEMPLATE, [
      { "@type": "Product", name: "Dress" },
    ]);

    expect(html).toContain('{"@type":"Product","name":"Dress"}');
  });

  it("leaves the template alone when there is nothing to inject", () => {
    expect(injectStructuredData(TEMPLATE, [])).toBe(TEMPLATE);
  });

  it("escapes < so a value can never close the script block early", () => {
    expect(escapeJsonLd({ name: "</script><script>alert(1)</script>" })).toBe(
      '{"name":"\\u003c/script>\\u003cscript>alert(1)\\u003c/script>"}',
    );
  });
});

describe("canonicalFor", () => {
  it("keeps the trailing slash only for the home route", () => {
    expect(canonicalFor("/")).toBe(`${SITE_ORIGIN}/`);
    expect(canonicalFor("/about")).toBe(`${SITE_ORIGIN}/about`);
    expect(canonicalFor("/about/")).toBe(`${SITE_ORIGIN}/about`);
  });
});

describe("renderSitemap", () => {
  it("lists each entry with its hints and the build date", () => {
    const xml = renderSitemap(
      [{ path: "/", changefreq: "monthly", priority: 1.0 }],
      "2026-08-18",
    );

    expect(xml).toContain(`<loc>${SITE_ORIGIN}/</loc>`);
    expect(xml).toContain("<lastmod>2026-08-18</lastmod>");
    expect(xml).toContain("<priority>1.0</priority>");
  });

  it("defaults changefreq and priority when a route sets neither", () => {
    const xml = renderSitemap([{ path: "/about" }], "2026-08-18");

    expect(xml).toContain("<changefreq>monthly</changefreq>");
    expect(xml).toContain("<priority>0.5</priority>");
  });
});

describe("pinterestVerifyTag", () => {
  it("emits the claim tag when a token is configured", () => {
    expect(pinterestVerifyTag("abc123")).toEqual([
      {
        tag: "meta",
        attrs: { name: "p:domain_verify", content: "abc123" },
        injectTo: "head",
      },
    ]);
  });

  it("emits nothing when unset or blank", () => {
    // An empty content attribute reads to Pinterest as a failed claim, which is
    // worse than simply not claiming the domain — so emit no tag at all.
    expect(pinterestVerifyTag(undefined)).toEqual([]);
    expect(pinterestVerifyTag("   ")).toEqual([]);
  });

  it("trims surrounding whitespace from a pasted token", () => {
    expect(pinterestVerifyTag("  abc123\n")[0]?.attrs.content).toBe("abc123");
  });
});
