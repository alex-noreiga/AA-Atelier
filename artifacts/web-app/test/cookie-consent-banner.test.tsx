import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import CookieConsentBanner from "@/components/cookie-consent-banner";
import { ConsentProvider, useConsent } from "@/lib/consent";

const STORAGE_KEY = "aa-cookie-consent";

// A probe so tests can read the live consent status without reaching into
// localStorage timing.
function StatusProbe() {
  const { status } = useConsent();
  return <span data-testid="status">{status}</span>;
}

function renderBanner() {
  const { hook } = memoryLocation({ path: "/" });
  return render(
    <ConsentProvider>
      <Router hook={hook}>
        <CookieConsentBanner />
        <StatusProbe />
      </Router>
    </ConsentProvider>,
  );
}

beforeEach(() => localStorage.clear());

describe("CookieConsentBanner", () => {
  it("shows while no choice has been made, linking to the privacy policy", () => {
    renderBanner();
    expect(screen.getByTestId("cookie-consent-banner")).toBeInTheDocument();
    expect(screen.getByTestId("cookie-consent-privacy-link")).toHaveAttribute(
      "href",
      "/privacy",
    );
  });

  it("does not show once a choice is stored", () => {
    localStorage.setItem(STORAGE_KEY, "denied");
    renderBanner();
    expect(
      screen.queryByTestId("cookie-consent-banner"),
    ).not.toBeInTheDocument();
  });

  it("Accept opts in and dismisses the banner", async () => {
    const user = userEvent.setup();
    renderBanner();

    await user.click(screen.getByTestId("cookie-consent-accept"));

    expect(screen.getByTestId("status")).toHaveTextContent("granted");
    expect(
      screen.queryByTestId("cookie-consent-banner"),
    ).not.toBeInTheDocument();
    expect(localStorage.getItem(STORAGE_KEY)).toBe("granted");
  });

  it("Decline opts out and dismisses the banner without analytics", async () => {
    const user = userEvent.setup();
    renderBanner();

    await user.click(screen.getByTestId("cookie-consent-decline"));

    expect(screen.getByTestId("status")).toHaveTextContent("denied");
    expect(
      screen.queryByTestId("cookie-consent-banner"),
    ).not.toBeInTheDocument();
    expect(localStorage.getItem(STORAGE_KEY)).toBe("denied");
  });
});
