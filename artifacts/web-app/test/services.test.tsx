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
    expect(screen.getByTestId("service-bespoke-commissions")).toBeInTheDocument();
    expect(
      screen.getByTestId("service-rhinestoning-embellishment"),
    ).toBeInTheDocument();
  });

  it("emits an ItemList of Service structured data built from the cards", () => {
    renderServices();

    const script = document.querySelector(
      'script[type="application/ld+json"]',
    );
    expect(script).not.toBeNull();
    const data = JSON.parse(script?.textContent ?? "{}");

    expect(data["@type"]).toBe("ItemList");
    // One Service entry per rendered card, positioned in order.
    const cards = screen.getAllByTestId(/^service-/);
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
