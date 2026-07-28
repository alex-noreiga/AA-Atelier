import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ConsentedAnalytics from "@/components/analytics";
import { ConsentProvider } from "@/lib/consent";

// Stand in for Vercel's <Analytics />, which renders null in a test env, so we
// can assert whether it was mounted at all.
vi.mock("@vercel/analytics/react", () => ({
  Analytics: () => <div data-testid="vercel-analytics" />,
}));

const STORAGE_KEY = "aa-cookie-consent";

function renderWithStored(value: string | null) {
  if (value) localStorage.setItem(STORAGE_KEY, value);
  return render(
    <ConsentProvider>
      <ConsentedAnalytics />
    </ConsentProvider>,
  );
}

beforeEach(() => localStorage.clear());

describe("ConsentedAnalytics", () => {
  it("does not load analytics before a choice is made", () => {
    renderWithStored(null);
    expect(screen.queryByTestId("vercel-analytics")).not.toBeInTheDocument();
  });

  it("does not load analytics when the visitor declined", () => {
    renderWithStored("denied");
    expect(screen.queryByTestId("vercel-analytics")).not.toBeInTheDocument();
  });

  it("loads analytics only once the visitor has accepted", () => {
    renderWithStored("granted");
    expect(screen.getByTestId("vercel-analytics")).toBeInTheDocument();
  });
});
