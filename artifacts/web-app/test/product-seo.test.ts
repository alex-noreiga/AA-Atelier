import { describe, it, expect } from "vitest";
import type { Product } from "@workspace/api-client-react";
import {
  breadcrumbJsonLd,
  productImages,
  productJsonLd,
  productMetaDescription,
  productTitle,
  productUrl,
} from "@/lib/product-seo";
import { SITE_ORIGIN, socialImages } from "@/lib/seo-routes";

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: "abc",
    title: "Aurora Dress",
    category: "Competition Dresses",
    sized: true,
    variants: [
      {
        id: "v1",
        name: "Rose",
        available: true,
        price: 480,
        photos: ["https://notion.test/a.jpg"],
        sizes: [],
      },
    ],
    ...overrides,
  } as Product;
}

describe("productMetaDescription", () => {
  it("collapses the listing note onto one line", () => {
    const p = product({
      variants: [
        {
          id: "v1",
          name: "Rose",
          available: true,
          photos: [],
          sizes: [],
          description: "Hand-beaded  bodice\nwith a chiffon skirt.",
        },
      ],
    } as Partial<Product>);

    expect(productMetaDescription(p)).toBe(
      "Hand-beaded bodice with a chiffon skirt.",
    );
  });

  it("falls back to title and category when there is no note", () => {
    expect(productMetaDescription(product())).toBe(
      "Aurora Dress — Competition Dresses from A.A Atelier.",
    );
  });

  it("truncates an over-long note to the meta-description budget", () => {
    const p = product({
      variants: [
        {
          id: "v1",
          name: "Rose",
          available: true,
          photos: [],
          sizes: [],
          description: "x".repeat(400),
        },
      ],
    } as Partial<Product>);
    const out = productMetaDescription(p);

    expect(out).toHaveLength(158); // 157 characters plus the ellipsis
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("productImages", () => {
  it("uses the product's own photograph, with no invented dimensions", () => {
    // Notion serves the photo and its pixel size is unknown here — declaring
    // one would describe the wrong aspect ratio to a scraper.
    expect(productImages(product())).toEqual([
      { url: "https://notion.test/a.jpg", alt: "Aurora Dress — A.A Atelier" },
    ]);
  });

  it("falls back to the shop's artwork when the product has no photo", () => {
    const p = product({
      variants: [
        { id: "v1", name: "Rose", available: true, photos: [], sizes: [] },
      ],
    } as Partial<Product>);

    expect(productImages(p)).toEqual(socialImages("/shop", productTitle(p)));
  });
});

describe("productJsonLd", () => {
  it("emits a plain Offer for a single priced variant", () => {
    expect(productJsonLd(product())).toMatchObject({
      "@type": "Product",
      sku: "abc",
      url: `${SITE_ORIGIN}/shop/abc`,
      brand: { "@type": "Brand", name: "A.A Atelier" },
      offers: {
        "@type": "Offer",
        price: 480,
        priceCurrency: "USD",
        availability: "https://schema.org/InStock",
      },
    });
  });

  it("collapses several priced variants into an AggregateOffer", () => {
    const p = product({
      variants: [
        {
          id: "v1",
          name: "Rose",
          available: false,
          price: 480,
          photos: [],
          sizes: [],
        },
        {
          id: "v2",
          name: "Ice",
          available: true,
          price: 520,
          photos: [],
          sizes: [],
        },
      ],
    } as Partial<Product>);

    expect(productJsonLd(p).offers).toMatchObject({
      "@type": "AggregateOffer",
      lowPrice: 480,
      highPrice: 520,
      offerCount: 2,
      // In stock while ANY priced variant is available.
      availability: "https://schema.org/InStock",
    });
  });

  it("omits offers entirely for an inquire-for-price product", () => {
    const p = product({
      variants: [
        { id: "v1", name: "Rose", available: true, photos: [], sizes: [] },
      ],
    } as Partial<Product>);

    expect(productJsonLd(p).offers).toBeUndefined();
  });

  it("reports every priced variant sold out when none is available", () => {
    const p = product({
      variants: [
        {
          id: "v1",
          name: "Rose",
          available: false,
          price: 480,
          photos: [],
          sizes: [],
        },
        {
          id: "v2",
          name: "Ice",
          available: false,
          price: 520,
          photos: [],
          sizes: [],
        },
      ],
    } as Partial<Product>);

    expect(productJsonLd(p).offers).toMatchObject({
      availability: "https://schema.org/OutOfStock",
    });
  });
});

describe("breadcrumbJsonLd", () => {
  it("walks Home › Shop › Product", () => {
    expect(breadcrumbJsonLd(product()).itemListElement).toEqual([
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
        name: "Aurora Dress",
        item: `${SITE_ORIGIN}/shop/abc`,
      },
    ]);
  });
});

describe("productTitle / productUrl", () => {
  it("suffixes the shop and brand, and builds the deep link", () => {
    expect(productTitle(product())).toBe(
      "Aurora Dress | The Shop | A.A Atelier",
    );
    expect(productUrl(product())).toBe(`${SITE_ORIGIN}/shop/abc`);
  });
});
