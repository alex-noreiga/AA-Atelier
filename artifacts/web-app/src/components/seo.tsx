import { useEffect } from "react";
import { imagesFor, type OgImage } from "@/lib/seo-routes";

/**
 * Per-page document metadata.
 *
 * This is a client-rendered SPA, so `index.html` ships a single static
 * `<title>`/description shared by every route. This component updates those
 * head tags *in place* on mount (and whenever its props change) so each page
 * gets its own title, description, canonical URL, and Open Graph / Twitter
 * card. Crawlers that execute JS (Google) see the per-page values; social
 * scrapers that don't still get the sensible static defaults from `index.html`.
 *
 * We mutate the existing tags rather than rendering React 19's native
 * `<title>`/`<meta>` deliberately: React does not dedupe `<meta>` by name, so
 * emitting a `<meta name="description">` would leave the static one in place and
 * produce two. `setAttribute` on the existing node overrides cleanly instead.
 */

/** Canonical production origin — used to build absolute canonical/og:url. */
export const SITE_ORIGIN = "https://a3iceanddance.com";

/** The brand name, shown as the `og:site_name` and title suffix source. */
export const SITE_NAME = "A3 Ice and Dance";

interface SeoProps {
  /** The full document title, e.g. "Custom Costumes | A.A Atelier". */
  title: string;
  /** Meta description — one to two sentences, keyword-aware. */
  description: string;
  /**
   * Route path for the canonical URL and og:url, e.g. "/about". Defaults to
   * "/" for the landing page. Trailing slashes are normalised away.
   */
  path?: string;
  /** When true, emits `<meta name="robots" content="noindex">` (e.g. 404). */
  noindex?: boolean;
  /**
   * Social share images for this route, in preference order. When omitted the
   * shared default set (`DEFAULT_OG_IMAGES`) is used, which matches what
   * `index.html` ships statically.
   */
  images?: OgImage[];
}

/** Find an existing head tag or create and append it. */
function upsertTag(selector: string, create: () => HTMLElement): HTMLElement {
  const existing = document.head.querySelector<HTMLElement>(selector);
  if (existing) return existing;
  const el = create();
  document.head.appendChild(el);
  return el;
}

function setMetaByName(name: string, content: string) {
  const el = upsertTag(`meta[name="${name}"]`, () => {
    const m = document.createElement("meta");
    m.setAttribute("name", name);
    return m;
  });
  el.setAttribute("content", content);
}

function setMetaByProperty(property: string, content: string) {
  const el = upsertTag(`meta[property="${property}"]`, () => {
    const m = document.createElement("meta");
    m.setAttribute("property", property);
    return m;
  });
  el.setAttribute("content", content);
}

/**
 * Replace every image tag in the head with the given set.
 *
 * The whole block is rebuilt rather than patched because `og:image:width` /
 * `:height` / `:alt` attach to the `og:image` they follow — patching tags
 * individually would let a route's image keep the *previous* image's
 * dimensions, which is exactly the bug this avoids. Selecting on the tag
 * prefixes also sweeps up the static tags `index.html` ships, so a route can
 * never end up advertising both its own image and the default.
 */
function setImages(images: OgImage[]) {
  document.head
    .querySelectorAll('meta[property^="og:image"], meta[name^="twitter:image"]')
    .forEach((el) => el.remove());

  const add = (attr: "property" | "name", key: string, content: string) => {
    const m = document.createElement("meta");
    m.setAttribute(attr, key);
    m.setAttribute("content", content);
    document.head.appendChild(m);
  };

  for (const image of images) {
    add("property", "og:image", image.url);
    // Only emit dimensions we actually know — a wrong width is worse than none.
    if (image.width !== undefined)
      add("property", "og:image:width", String(image.width));
    if (image.height !== undefined)
      add("property", "og:image:height", String(image.height));
    if (image.alt) add("property", "og:image:alt", image.alt);
  }

  // A Twitter card carries a single image: the primary one.
  const primary = images[0];
  if (primary) {
    add("name", "twitter:image", primary.url);
    if (primary.alt) add("name", "twitter:image:alt", primary.alt);
  }
}

function setLinkRel(rel: string, href: string) {
  const el = upsertTag(`link[rel="${rel}"]`, () => {
    const l = document.createElement("link");
    l.setAttribute("rel", rel);
    return l;
  });
  el.setAttribute("href", href);
}

export function Seo({
  title,
  description,
  path = "/",
  noindex = false,
  images,
}: SeoProps) {
  useEffect(() => {
    const canonical =
      SITE_ORIGIN + (path === "/" ? "/" : `/${path.replace(/^\/|\/$/g, "")}`);

    document.title = title;
    setMetaByName("description", description);
    setLinkRel("canonical", canonical);

    setMetaByProperty("og:title", title);
    setMetaByProperty("og:description", description);
    setMetaByProperty("og:url", canonical);

    setMetaByName("twitter:title", title);
    setMetaByName("twitter:description", description);

    setImages(imagesFor({ path, title, images, noindex }));

    setMetaByName("robots", noindex ? "noindex, follow" : "index, follow");
    // `images` is an array literal at most call sites, so depend on its content
    // rather than its identity to avoid rebuilding the block on every render.
  }, [title, description, path, noindex, JSON.stringify(images ?? null)]);

  return null;
}

/**
 * Injects a JSON-LD `<script>` into the head for the mounted route and removes
 * it on unmount, so per-page structured data (e.g. an About-page FAQPage) never
 * leaks onto other routes. The `data` object is serialised as-is; keep it a
 * plain schema.org shape.
 */
export function StructuredData({ data }: { data: Record<string, unknown> }) {
  useEffect(() => {
    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.dataset.seo = "structured-data";
    script.textContent = JSON.stringify(data);
    document.head.appendChild(script);
    return () => {
      script.remove();
    };
  }, [data]);

  return null;
}
