import { useEffect } from "react";

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
   * Optional absolute og:image / twitter:image for this route. When omitted the
   * static default from `index.html` (`/opengraph.jpg`) is left in place.
   */
  image?: string;
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
  image,
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

    if (image) {
      setMetaByProperty("og:image", image);
      setMetaByName("twitter:image", image);
    }

    setMetaByName("robots", noindex ? "noindex, follow" : "index, follow");
  }, [title, description, path, noindex, image]);

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
