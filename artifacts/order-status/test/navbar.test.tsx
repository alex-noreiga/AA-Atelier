import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import Navbar from "@/components/navbar";

// Navbar is static — it fetches nothing, so there is no hook to mock here. It
// does need a wouter location, which memoryLocation supplies without a browser.
function renderAt(path: string) {
  const { hook } = memoryLocation({ path });
  return render(
    <Router hook={hook}>
      <Navbar />
    </Router>,
  );
}

/** Desktop links live in the bar; mobile ones only exist once the Sheet opens. */
const desktop = (id: string) => screen.getByTestId(`nav-${id}`);

const isHighlighted = (el: HTMLElement) =>
  el.className.includes("text-primary");

describe("Navbar", () => {
  it("renders the five top-level links", () => {
    renderAt("/");

    for (const id of ["home", "about", "services", "shop", "contact"]) {
      expect(desktop(id)).toBeVisible();
    }
  });

  it("keeps the Services submenu closed until its trigger is used", async () => {
    renderAt("/");

    expect(screen.queryByTestId("nav-place-an-order")).not.toBeInTheDocument();

    await userEvent.click(desktop("services"));

    expect(screen.getByTestId("nav-overview")).toHaveAttribute(
      "href",
      "/services",
    );
    expect(screen.getByTestId("nav-place-an-order")).toHaveAttribute(
      "href",
      "/order",
    );
    expect(screen.getByTestId("nav-track-your-order")).toHaveAttribute(
      "href",
      "/shop/status",
    );
  });

  it("marks Services active on the order form", () => {
    renderAt("/order");

    expect(isHighlighted(desktop("services"))).toBe(true);
    expect(isHighlighted(desktop("shop"))).toBe(false);
  });

  it("marks Services — not Shop — active on the order status page", () => {
    renderAt("/shop/status");

    expect(isHighlighted(desktop("services"))).toBe(true);
    expect(isHighlighted(desktop("shop"))).toBe(false);
  });

  it("marks Shop active on the shop itself", () => {
    renderAt("/shop");

    expect(isHighlighted(desktop("shop"))).toBe(true);
    expect(isHighlighted(desktop("services"))).toBe(false);
  });

  it("lists the Services children inline in the mobile menu", async () => {
    renderAt("/");

    await userEvent.click(screen.getByTestId("button-menu"));

    expect(screen.getByTestId("nav-mobile-home")).toBeVisible();
    expect(screen.getByTestId("nav-mobile-overview")).toHaveAttribute(
      "href",
      "/services",
    );
    expect(screen.getByTestId("nav-mobile-place-an-order")).toHaveAttribute(
      "href",
      "/order",
    );
    expect(screen.getByTestId("nav-mobile-track-your-order")).toHaveAttribute(
      "href",
      "/shop/status",
    );
  });
});
