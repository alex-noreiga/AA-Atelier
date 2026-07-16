import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import Footer from "@/components/footer";

// Footer fetches nothing, but it renders wouter <Link>s, so it needs a Router.
function renderFooter() {
  const { hook } = memoryLocation({ path: "/" });
  return render(
    <Router hook={hook}>
      <Footer />
    </Router>,
  );
}

describe("Footer", () => {
  it("links to every legal/policy page", () => {
    renderFooter();

    expect(screen.getByTestId("footer-company-privacy-policy")).toHaveAttribute(
      "href",
      "/privacy",
    );
    expect(
      screen.getByTestId("footer-company-terms-of-service"),
    ).toHaveAttribute("href", "/terms");
    expect(
      screen.getByTestId("footer-company-shipping-&-returns"),
    ).toHaveAttribute("href", "/shipping-returns");
  });

  it("exposes the studio contact and social links", () => {
    renderFooter();

    expect(screen.getByTestId("footer-email")).toHaveAttribute(
      "href",
      "mailto:hello@a3iceanddance.com",
    );

    const instagram = screen.getByTestId("footer-instagram");
    expect(instagram).toHaveAttribute("href", "https://instagram.com/a3iceanddance");
    expect(instagram).toHaveAttribute("target", "_blank");
    expect(instagram).toHaveAttribute("rel", "noreferrer");
  });

  it("links back to the primary pages", () => {
    renderFooter();

    expect(screen.getByTestId("footer-explore-portfolio")).toHaveAttribute(
      "href",
      "/portfolio",
    );
    expect(screen.getByTestId("footer-explore-shop")).toHaveAttribute(
      "href",
      "/shop",
    );
  });
});
