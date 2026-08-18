/**
 * Pure HTML rendering for the build-time SEO prerender.
 *
 * The SPA's runtime `<Seo>` component only reaches crawlers that execute JS.
 * Social scrapers (Pinterest, Facebook, LinkedIn, Slack, iMessage) do not, so
 * `vite.config.ts`'s `seo-prerender` plugin bakes each route's head tags into a
 * static HTML file at build time. This module holds the string transforms that
 * do the baking, kept free of `fs` and of Vite's plugin API so they can be
 * unit-tested directly — the plugin is left as a thin filesystem shell.
 *
 * Everything here reads its data from `seo-routes.ts`, the same source the
 * runtime component uses, so the two cannot disagree.
 */

import {
  SITE_ORIGIN,
  imagesFor,
  type OgImage,
  type RouteSeo,
} from "./seo-routes";

/** HTML text-node escaping (for the <title> element). */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Attribute-value escaping (for meta/link content/href). */
export function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/**
 * Escaping for text inside a `<script type="application/ld+json">` block. JSON
 * has no HTML escaping of its own, so a `</script>` sequence appearing in any
 * string value would close the block early; `<` is escaped to its unicode
 * form, which is valid JSON and inert to the HTML parser.
 */
export function escapeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/** Absolute canonical URL for a route — mirrors the logic in components/seo.tsx. */
export function canonicalFor(routePath: string): string {
  return (
    SITE_ORIGIN +
    (routePath === "/" ? "/" : `/${routePath.replace(/^\/|\/$/g, "")}`)
  );
}

/** Marker comments in `index.html` delimiting the replaceable image block. */
const IMAGE_BLOCK_RE =
  /(<!-- seo:images:start -->)[\s\S]*?(<!-- seo:images:end -->)/;

/** Marker comment in `index.html` where per-route JSON-LD is injected. */
const STRUCTURED_DATA_MARKER = "<!-- seo:structured-data -->";

/** The head tags for one image, in Open Graph structured-property order. */
function imageTags(image: OgImage): string[] {
  const tags = [
    `    <meta property="og:image" content="${escapeAttr(image.url)}" />`,
  ];
  // Emit only dimensions we actually know: a width inherited from a different
  // image is worse for a scraper than no width at all.
  if (image.width !== undefined)
    tags.push(
      `    <meta property="og:image:width" content="${image.width}" />`,
    );
  if (image.height !== undefined)
    tags.push(
      `    <meta property="og:image:height" content="${image.height}" />`,
    );
  if (image.alt)
    tags.push(
      `    <meta property="og:image:alt" content="${escapeAttr(image.alt)}" />`,
    );
  return tags;
}

/**
 * Render the full `seo:images` block: every image with its own structured
 * properties, then the single Twitter image pointing at the primary one.
 */
export function renderImageBlock(images: OgImage[]): string {
  const lines = images.flatMap(imageTags);
  const primary = images[0];
  if (primary) {
    lines.push(
      `    <meta name="twitter:image" content="${escapeAttr(primary.url)}" />`,
    );
    if (primary.alt)
      lines.push(
        `    <meta name="twitter:image:alt" content="${escapeAttr(primary.alt)}" />`,
      );
  }
  return lines.join("\n");
}

/**
 * Swap a route's images into the marked block.
 *
 * The block is replaced wholesale rather than patched tag-by-tag because
 * `og:image:width` / `:height` / `:alt` bind to the `og:image` they follow, so
 * an image and its dimensions have to move together. Throws when the markers
 * are missing rather than silently shipping every route with the default
 * image — a failed build is recoverable, a whole site of wrong share cards
 * discovered weeks later is not.
 */
export function replaceImageBlock(html: string, images: OgImage[]): string {
  if (!IMAGE_BLOCK_RE.test(html)) {
    throw new Error(
      "seo-prerender: the <!-- seo:images:start --> / <!-- seo:images:end --> markers " +
        "are missing from index.html; per-route share images cannot be written.",
    );
  }
  return html.replace(
    IMAGE_BLOCK_RE,
    (_m, start: string, end: string) =>
      `${start}\n${renderImageBlock(images)}\n    ${end}`,
  );
}

/** Inject `<script type="application/ld+json">` blocks at the marker. */
export function injectStructuredData(
  html: string,
  blocks: Record<string, unknown>[],
): string {
  if (blocks.length === 0 || !html.includes(STRUCTURED_DATA_MARKER))
    return html;
  const scripts = blocks
    .map(
      (b) =>
        `    <script type="application/ld+json">\n      ${escapeJsonLd(b)}\n    </script>`,
    )
    .join("\n");
  return html.replace(
    STRUCTURED_DATA_MARKER,
    `${STRUCTURED_DATA_MARKER}\n${scripts}`,
  );
}

/**
 * Rewrite the head of the built `index.html` template for a single route:
 * title, description, canonical, og/twitter title/description/url, robots, and
 * the whole `seo:images` block. Every other tag (Organization JSON-LD, fonts,
 * manifest) is left untouched. `[^>]` matches newlines, so this handles the
 * multi-line meta tags in index.html without a DOM parser.
 */
export function renderRouteHtml(
  template: string,
  route: RouteSeo,
  structuredData: Record<string, unknown>[] = [],
): string {
  const canonical = canonicalFor(route.path);
  let html = template.replace(
    /<title>[\s\S]*?<\/title>/,
    `<title>${escapeHtml(route.title)}</title>`,
  );

  const setMeta = (attr: string, value: string) => {
    const re = new RegExp(`(<meta[^>]*${attr}[^>]*content=")[^"]*(")`);
    html = html.replace(re, `$1${escapeAttr(value)}$2`);
  };

  setMeta('name="description"', route.description);
  setMeta('property="og:title"', route.title);
  setMeta('property="og:description"', route.description);
  setMeta('property="og:url"', canonical);
  setMeta('name="twitter:title"', route.title);
  setMeta('name="twitter:description"', route.description);
  setMeta('name="robots"', route.noindex ? "noindex, follow" : "index, follow");

  html = replaceImageBlock(html, imagesFor(route));
  html = injectStructuredData(html, structuredData);

  html = html.replace(
    /(<link[^>]*rel="canonical"[^>]*href=")[^"]*(")/,
    `$1${escapeAttr(canonical)}$2`,
  );
  return html;
}

/** A `<url>` entry for the sitemap. */
export interface SitemapEntry {
  path: string;
  changefreq?: string;
  priority?: number;
}

export function renderSitemap(
  entries: SitemapEntry[],
  buildDate: string,
): string {
  const urls = entries
    .map((r) =>
      [
        "  <url>",
        `    <loc>${canonicalFor(r.path)}</loc>`,
        `    <lastmod>${buildDate}</lastmod>`,
        `    <changefreq>${r.changefreq ?? "monthly"}</changefreq>`,
        `    <priority>${(r.priority ?? 0.5).toFixed(1)}</priority>`,
        "  </url>",
      ].join("\n"),
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/** One head tag, in the shape Vite's `transformIndexHtml` hook consumes. */
export interface HeadTag {
  tag: string;
  attrs: Record<string, string>;
  injectTo: "head";
}

/**
 * The Pinterest domain-claim tag, or nothing when unconfigured.
 *
 * Claiming a3iceanddance.com in Pinterest is what attributes every Pin saved
 * from the site back to the studio's account (logo on the Pin, and access to
 * the analytics for saves and outbound clicks). The claim is a one-off token
 * Pinterest issues; it is public by design, so it lives in an ordinary build
 * env var rather than a secret.
 *
 * Unset ⇒ no tag at all, rather than an empty one: an empty `content` reads to
 * Pinterest as a failed claim, which is worse than an unclaimed domain.
 */
export function pinterestVerifyTag(token: string | undefined): HeadTag[] {
  const content = token?.trim();
  if (!content) return [];
  return [
    {
      tag: "meta",
      attrs: { name: "p:domain_verify", content },
      injectTo: "head",
    },
  ];
}
