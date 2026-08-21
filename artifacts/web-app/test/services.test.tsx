import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import Services from "@/pages/services";

// Services renders wouter <Link>s (the CTAs), so it needs a Router.
function renderServices() {
  const { hook } = memoryLocation({ path: "/services" });
  return render(
    <Router hook={hook}>
      <Services />
    </Router>,
  );
}

describe("Services", () => {
  it("renders the service cards", () => {
    renderServices();
    expect(
      screen.getByTestId("service-bespoke-commissions"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("service-rhinestoning-embellishment"),
    ).toBeInTheDocument();
  });

  it("starts each service's own intake from its card", () => {
    renderServices();

    // The three standalone services are no longer funnelled through a
    // commission form asking for measurements they don't need.
    expect(screen.getByTestId("cta-service-bespoke")).toHaveAttribute(
      "href",
      "/order?service=bespoke",
    );
    expect(screen.getByTestId("cta-service-alterations")).toHaveAttribute(
      "href",
      "/order?service=alterations",
    );
    expect(screen.getByTestId("cta-service-rhinestoning")).toHaveAttribute(
      "href",
      "/order?service=rhinestoning",
    );
    expect(screen.getByTestId("cta-service-repairs")).toHaveAttribute(
      "href",
      "/order?service=repairs",
    );
    // The page's own bottom CTA preselects the commission, matching its card.
    expect(screen.getByTestId("cta-begin-commission")).toHaveAttribute(
      "href",
      "/order?service=bespoke",
    );
  });

  it("emits an ItemList of Service structured data built from the cards", () => {
    renderServices();

    const script = document.querySelector('script[type="application/ld+json"]');
    expect(script).not.toBeNull();
    const data = JSON.parse(script?.textContent ?? "{}");

    expect(data["@type"]).toBe("ItemList");
    // One Service entry per rendered card, positioned in order.
    // Card testids only — the per-card CTAs are `cta-service-*`, so this
    // count stays one-per-card.
    const cards = screen.getAllByTestId(/^service-[a-z]/);
    expect(data.itemListElement).toHaveLength(cards.length);
    expect(data.itemListElement[0]).toMatchObject({
      "@type": "ListItem",
      position: 1,
      item: {
        "@type": "Service",
        name: "Bespoke Commissions",
        provider: { "@type": "Organization", name: "A.A Atelier" },
      },
    });
  });
});
