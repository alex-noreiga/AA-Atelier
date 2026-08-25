/**
 * Per-product page metadata and structured data.
 *
 * Pure and dependency-free (types only) so it can be used from three places
 * without drift:
 *
 *   1. `pages/shop.tsx`, for the runtime head tags on a `/shop/:id` deep link.
 *   2. The build-time prerender plugin, which bakes the same tags into a static
 *      `dist/public/shop/<id>/index.html` — the only version a social scraper
 *      (Pinterest, Facebook, Slack) or a non-JS crawler will ever see.
 *   3. That plugin's sitemap pass.
 *
 * Before this existed the product tags were client-only, so scraping a product
 * URL yielded the SPA fallback — i.e. the *home page's* title, description, and
 * share image. Pinning a dress produced a card for the home page.
 */

import type { Product } from "@workspace/api-client-react";
import { SITE_ORIGIN, socialImages, type OgImage } from "./seo-routes";

const IN_STOCK = "https://schema.org/InStock";
const OUT_OF_STOCK = "https://schema.org/OutOfStock";

/** Canonical URL of a product's deep link. */
export function productUrl(product: Pick<Product, "id">): string {
  return `${SITE_ORIGIN}/shop/${product.id}`;
}

/** Document title for a product page. */
export function productTitle(product: Pick<Product, "title">): string {
  return `${product.title} | The Shop | A.A Atelier`;
}

/** Collapse Notion listing notes into a single-line, length-capped meta description. */
export function productMetaDescription(product: Product): string {
  const raw = product.variants[0]?.description?.replace(/\s+/g, " ").trim();
  const base =
    raw && raw.length > 0
      ? raw
      : `${product.title}, ${product.category} from A.A Atelier.`;
  return base.length > 160 ? `${base.slice(0, 157)}…` : base;
}

/**
 * The share images for a product: its own photograph, which is the strongest
 * possible pin — a real garment beats any typographic card. Notion serves the
 * photo and we don't know its pixel size, so it carries no width/height rather
 * than borrowing another image's. A product with no photo falls back to the
 * shop's generated artwork.
 */
export function productImages(product: Product): OgImage[] {
  const photo = product.variants[0]?.photos[0];
  return photo
    ? [{ url: photo, alt: `${product.title} from A.A Atelier` }]
    : socialImages("/shop", productTitle(product));
}

/**
 * schema.org Product + Offer(s) for a shop card, for search-result rich data.
 * Carries the fields Google recommends for Product rich results — `brand`,
 * `sku`, `url`, and `image` — and collapses multiple priced variants into an
 * `AggregateOffer` (a single variant stays a plain `Offer`).
 */
export function productJsonLd(product: Product): Record<string, unknown> {
  const variant = product.variants[0];
  const url = productUrl(product);
  const pricedVariants = product.variants.filter(
    (v) => typeof v.price === "number",
  );
  const prices = pricedVariants
    .map((v) => v.price)
    .filter((p): p is number => typeof p === "number");

  let offers: Record<string, unknown> | undefined;
  if (pricedVariants.length === 1) {
    offers = {
      "@type": "Offer",
      price: pricedVariants[0].price,
      priceCurrency: "USD",
      availability: pricedVariants[0].available ? IN_STOCK : OUT_OF_STOCK,
      url,
    };
  } else if (prices.length > 1) {
    offers = {
      "@type": "AggregateOffer",
      lowPrice: Math.min(...prices),
      highPrice: Math.max(...prices),
      priceCurrency: "USD",
      offerCount: prices.length,
      // Available if any priced variant is in stock.
      availability: pricedVariants.some((v) => v.available)
        ? IN_STOCK
        : OUT_OF_STOCK,
      url,
    };
  }

  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    category: product.category,
    brand: { "@type": "Brand", name: "A.A Atelier" },
    sku: product.id,
    url,
    ...(variant?.description ? { description: variant.description } : {}),
    ...(variant && variant.photos.length > 0 ? { image: variant.photos } : {}),
    ...(offers ? { offers } : {}),
  };
}

/** Home › Shop › Product breadcrumb trail, so search results show the path. */
export function breadcrumbJsonLd(product: Product): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: `${SITE_ORIGIN}/`,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Shop",
        item: `${SITE_ORIGIN}/shop`,
      },
      {
        "@type": "ListItem",
        position: 3,
        name: product.title,
        item: productUrl(product),
      },
    ],
  };
}
