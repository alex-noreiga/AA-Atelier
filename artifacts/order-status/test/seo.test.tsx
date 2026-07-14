import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Seo, SITE_ORIGIN } from "@/components/seo";

// The head tags a component-under-test would inherit from index.html at runtime.
// jsdom starts with an empty <head>, so seed the ones Seo updates in place to
// prove it *overrides* rather than appends a duplicate.
function seedStaticHead() {
  document.head.innerHTML = "";
  const desc = document.createElement("meta");
  desc.setAttribute("name", "description");
  desc.setAttribute("content", "static default");
  document.head.appendChild(desc);
}

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
});
