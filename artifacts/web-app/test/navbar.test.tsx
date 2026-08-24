import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Navbar from "@/components/navbar";
import { CartProvider } from "@/lib/cart";

// Whether the signed-in account is studio staff is the server's answer, fetched
// through the generated client; the navbar only decides what to do with it. The
// hook is mocked so each test states the answer outright — the fetch itself is
// covered in studio-access.test.tsx.
const h = vi.hoisted(() => ({ staff: false }));
vi.mock("@/lib/studio-access", () => ({
  useStudioAccess: () => ({ staff: h.staff, loading: false }),
}));

beforeEach(() => {
  h.staff = false;
});

// Navbar fetches nothing itself, but it renders the cart button, which reads the
// cart context and instantiates a react-query mutation — so it needs a
// CartProvider and a QueryClientProvider. memoryLocation supplies the wouter
// location without a browser.
function renderAt(path: string) {
  const { hook } = memoryLocation({ path });
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <CartProvider>
        <Router hook={hook}>
          <Navbar />
        </Router>
      </CartProvider>
    </QueryClientProvider>,
  );
}

/** Desktop links live in the bar; mobile ones only exist once the Sheet opens. */
const desktop = (id: string) => screen.getByTestId(`nav-${id}`);

const isHighlighted = (el: HTMLElement) =>
  el.className.includes("text-primary");

describe("Navbar", () => {
  it("renders the public top-level links", () => {
    renderAt("/");

    for (const id of [
      "home",
      "about",
      "services",
      "portfolio",
      "shop",
      "contact",
    ]) {
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
      "/track",
    );
  });

  it("marks Services active on the order form", () => {
    renderAt("/order");

    expect(isHighlighted(desktop("services"))).toBe(true);
    expect(isHighlighted(desktop("shop"))).toBe(false);
  });

  it("marks Services — not Shop — active on the order status page", () => {
    renderAt("/track");

    expect(isHighlighted(desktop("services"))).toBe(true);
    expect(isHighlighted(desktop("shop"))).toBe(false);
  });

  it("marks Shop active on the shop itself", () => {
    renderAt("/shop");

    expect(isHighlighted(desktop("shop"))).toBe(true);
    expect(isHighlighted(desktop("services"))).toBe(false);
  });

  it("shows Account, and no dashboard, to a visitor the server hasn't confirmed", async () => {
    renderAt("/");

    expect(desktop("account")).toHaveAttribute("href", "/account");
    expect(screen.queryByTestId("nav-dashboard")).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId("button-menu"));
    expect(
      screen.queryByTestId("nav-mobile-dashboard"),
    ).not.toBeInTheDocument();
  });

  it("swaps Account for the Dashboard on a confirmed staff account", async () => {
    h.staff = true;
    renderAt("/");

    expect(desktop("dashboard")).toHaveAttribute("href", "/studio");
    // Staff get the dashboard *instead of* the portal, not as well as it —
    // their customer account has nothing in it.
    expect(screen.queryByTestId("nav-account")).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId("button-menu"));
    expect(screen.getByTestId("nav-mobile-dashboard")).toHaveAttribute(
      "href",
      "/studio",
    );
    expect(screen.queryByTestId("nav-mobile-account")).not.toBeInTheDocument();
  });

  it("keeps the Dashboard in Account's place in the bar", () => {
    h.staff = true;
    renderAt("/");

    const labels = screen
      .getAllByTestId(/^nav-(?!mobile)/)
      .map((el) => el.textContent?.trim());

    expect(labels).toEqual([
      "Home",
      "About",
      "Services",
      "Portfolio",
      "Shop",
      "Dashboard",
      "Contact",
    ]);
  });

  it("marks the Dashboard active on the dashboard itself", () => {
    h.staff = true;
    renderAt("/studio");

    expect(isHighlighted(desktop("dashboard"))).toBe(true);
    expect(isHighlighted(desktop("shop"))).toBe(false);
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
      "/track",
    );
  });
});
