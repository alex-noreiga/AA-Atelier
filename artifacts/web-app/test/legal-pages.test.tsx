import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConsentProvider } from "@/lib/consent";
import Privacy from "@/pages/privacy";
import Terms from "@/pages/terms";
import ShippingReturns from "@/pages/shipping-returns";

// The legal pages are static — they fetch nothing. Terms renders bare; Shipping
// carries wouter <Link>s into /track (wouter's default router needs no provider
// in jsdom); Privacy carries the "Manage cookie preferences" control, so it
// needs the ConsentProvider the app wraps it in.

describe("Privacy", () => {
  it("renders the heading and the service-providers section", () => {
    render(
      <ConsentProvider>
        <Privacy />
      </ConsentProvider>,
    );
    expect(
      screen.getByRole("heading", { name: "Privacy Policy", level: 1 }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Service providers" }),
    ).toBeInTheDocument();
    // The marketing-email / unsubscribe disclosure must be present now that the
    // app collects newsletter opt-ins and sends campaigns.
    expect(
      screen.getByRole("heading", { name: "Marketing emails" }),
    ).toBeInTheDocument();
  });

  it("lets a visitor revisit their cookie choice", () => {
    render(
      <ConsentProvider>
        <Privacy />
      </ConsentProvider>,
    );
    expect(
      screen.getByRole("heading", { name: "Cookies and analytics" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("manage-cookie-preferences")).toBeInTheDocument();
  });
});

describe("Terms", () => {
  it("renders the heading and the deposits/payment section", () => {
    render(<Terms />);
    expect(
      screen.getByRole("heading", { name: "Terms of Service", level: 1 }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Deposits and payment" }),
    ).toBeInTheDocument();
  });
});

describe("ShippingReturns", () => {
  it("renders the heading and the custom-orders-final-sale section", () => {
    render(<ShippingReturns />);
    expect(
      screen.getByRole("heading", { name: "Shipping & Returns", level: 1 }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Custom orders are final sale" }),
    ).toBeInTheDocument();
  });
});
