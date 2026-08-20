import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Seo, SITE_ORIGIN } from "@/components/seo";
import { DEFAULT_OG_IMAGES } from "@/lib/seo-routes";

// The head tags a component-under-test would inherit from index.html at runtime.
// jsdom starts with an empty <head>, so seed the ones Seo updates in place to
// prove it *overrides* rather than appends a duplicate.
function seedStaticHead() {
  document.head.innerHTML = "";
  const desc = document.createElement("meta");
  desc.setAttribute("name", "description");
  desc.setAttribute("content", "static default");
  document.head.appendChild(desc);

  // The image tags index.html ships, including the dimensions of the default
  // landscape image — the ones a per-route image must not inherit.
  const staticImageTags: Array<[string, string, string]> = [
    ["property", "og:image", "https://a3iceanddance.com/opengraph.jpg"],
    ["property", "og:image:width", "1280"],
    ["property", "og:image:height", "720"],
    ["property", "og:image:alt", "static alt"],
    ["name", "twitter:image", "https://a3iceanddance.com/opengraph.jpg"],
    ["name", "twitter:image:alt", "static alt"],
  ];
  for (const [attr, key, content] of staticImageTags) {
    const m = document.createElement("meta");
    m.setAttribute(attr, key);
    m.setAttribute("content", content);
    document.head.appendChild(m);
  }
}

const allContent = (selector: string) =>
  Array.from(document.head.querySelectorAll(selector)).map((el) =>
    el.getAttribute("content"),
  );

const metaContent = (attr: "name" | "property", value: string) =>
  document.head
    .querySelector(`meta[${attr}="${value}"]`)
    ?.getAttribute("content");

describe("Seo", () => {
  it("sets the document title and description", () => {
    seedStaticHead();
    render(
      <Seo
        title="About | A.A Atelier"
        description="About the atelier."
        path="/about"
      />,
    );

    expect(document.title).toBe("About | A.A Atelier");
    expect(metaContent("name", "description")).toBe("About the atelier.");
  });

  it("overrides the existing description in place rather than duplicating it", () => {
    seedStaticHead();
    render(<Seo title="t" description="fresh description" path="/about" />);

    expect(
      document.head.querySelectorAll('meta[name="description"]'),
    ).toHaveLength(1);
    expect(metaContent("name", "description")).toBe("fresh description");
  });

  it("builds an absolute canonical and og:url from the path", () => {
    seedStaticHead();
    render(<Seo title="t" description="d" path="/services" />);

    expect(
      document.head
        .querySelector('link[rel="canonical"]')
        ?.getAttribute("href"),
    ).toBe(`${SITE_ORIGIN}/services`);
    expect(metaContent("property", "og:url")).toBe(`${SITE_ORIGIN}/services`);
  });

  it("uses the bare origin for the home path", () => {
    seedStaticHead();
    render(<Seo title="t" description="d" path="/" />);

    expect(
      document.head
        .querySelector('link[rel="canonical"]')
        ?.getAttribute("href"),
    ).toBe(`${SITE_ORIGIN}/`);
  });

  it("mirrors title and description into the Open Graph and Twitter tags", () => {
    seedStaticHead();
    render(
      <Seo
        title="Shop | A.A Atelier"
        description="Ready to wear."
        path="/shop"
      />,
    );

    expect(metaContent("property", "og:title")).toBe("Shop | A.A Atelier");
    expect(metaContent("property", "og:description")).toBe("Ready to wear.");
    expect(metaContent("name", "twitter:title")).toBe("Shop | A.A Atelier");
    expect(metaContent("name", "twitter:description")).toBe("Ready to wear.");
  });

  it("emits index directives by default and noindex when asked", () => {
    seedStaticHead();
    const { rerender } = render(<Seo title="t" description="d" />);
    expect(metaContent("name", "robots")).toBe("index, follow");

    rerender(<Seo title="t" description="d" noindex />);
    expect(metaContent("name", "robots")).toBe("noindex, follow");
  });

  describe("share images", () => {
    it("uses an indexable route's own generated pair, landscape first", () => {
      seedStaticHead();
      render(<Seo title="About | A.A Atelier" description="d" path="/about" />);

      expect(allContent('meta[property="og:image"]')).toEqual([
        `${SITE_ORIGIN}/social/about-og.png`,
        `${SITE_ORIGIN}/social/about-pin.png`,
      ]);
      expect(allContent('meta[property="og:image:width"]')).toEqual([
        "1200",
        "1000",
      ]);
    });

    it("falls back to the shared default set for a route with no art", () => {
      seedStaticHead();
      render(<Seo title="t" description="d" path="/track" noindex />);

      expect(allContent('meta[property="og:image"]')).toEqual(
        DEFAULT_OG_IMAGES.map((i) => i.url),
      );
    });

    it("emits each image with its own width, height, and alt, in order", () => {
      seedStaticHead();
      render(
        <Seo
          title="t"
          description="d"
          path="/about"
          images={[
            {
              url: "https://x.test/wide.jpg",
              width: 1200,
              height: 630,
              alt: "wide",
            },
            {
              url: "https://x.test/tall.jpg",
              width: 1000,
              height: 1500,
              alt: "tall",
            },
          ]}
        />,
      );

      expect(allContent('meta[property="og:image"]')).toEqual([
        "https://x.test/wide.jpg",
        "https://x.test/tall.jpg",
      ]);
      expect(allContent('meta[property="og:image:width"]')).toEqual([
        "1200",
        "1000",
      ]);
      expect(allContent('meta[property="og:image:height"]')).toEqual([
        "630",
        "1500",
      ]);
      expect(allContent('meta[property="og:image:alt"]')).toEqual([
        "wide",
        "tall",
      ]);
    });

    it("omits dimensions for an image whose size is unknown", () => {
      seedStaticHead();
      render(
        <Seo
          title="t"
          description="d"
          path="/shop/abc"
          images={[{ url: "https://notion.test/photo.jpg", alt: "a dress" }]}
        />,
      );

      // The static 1280x720 must not survive to describe a remote photo.
      expect(allContent('meta[property="og:image"]')).toEqual([
        "https://notion.test/photo.jpg",
      ]);
      expect(allContent('meta[property="og:image:width"]')).toEqual([]);
      expect(allContent('meta[property="og:image:height"]')).toEqual([]);
      expect(allContent('meta[property="og:image:alt"]')).toEqual(["a dress"]);
    });

    it("points the single Twitter image at the primary image", () => {
      seedStaticHead();
      render(
        <Seo
          title="t"
          description="d"
          path="/about"
          images={[
            {
              url: "https://x.test/wide.jpg",
              width: 1200,
              height: 630,
              alt: "wide",
            },
            {
              url: "https://x.test/tall.jpg",
              width: 1000,
              height: 1500,
              alt: "tall",
            },
          ]}
        />,
      );

      expect(allContent('meta[name="twitter:image"]')).toEqual([
        "https://x.test/wide.jpg",
      ]);
      expect(allContent('meta[name="twitter:image:alt"]')).toEqual(["wide"]);
    });

    it("replaces the previous image set rather than accumulating tags", () => {
      seedStaticHead();
      const { rerender } = render(
        <Seo
          title="t"
          description="d"
          path="/shop/one"
          images={[{ url: "https://x.test/one.jpg" }]}
        />,
      );
      rerender(
        <Seo
          title="t"
          description="d"
          path="/shop/two"
          images={[{ url: "https://x.test/two.jpg" }]}
        />,
      );

      expect(allContent('meta[property="og:image"]')).toEqual([
        "https://x.test/two.jpg",
      ]);
    });
  });
});
