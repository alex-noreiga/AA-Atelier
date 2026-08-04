import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { useAnalytics, AnalyticsEvent } from "@/lib/analytics";
import { ConsentProvider } from "@/lib/consent";

// Spy on Vercel's `track`. `vi.hoisted` lets the mock factory reference it
// despite vi.mock being hoisted above the imports.
const { track } = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock("@vercel/analytics", () => ({ track }));

const STORAGE_KEY = "aa-cookie-consent";

function wrapper({ children }: { children: ReactNode }) {
  return <ConsentProvider>{children}</ConsentProvider>;
}

beforeEach(() => localStorage.clear());

describe("useAnalytics (consent-gated funnel events)", () => {
  it("emits nothing before a consent choice is made", () => {
    const { result } = renderHook(() => useAnalytics(), { wrapper });
    result.current(AnalyticsEvent.AddToCart, { price: 10, quantity: 1 });
    expect(track).not.toHaveBeenCalled();
  });

  it("emits nothing when the visitor declined", () => {
    localStorage.setItem(STORAGE_KEY, "denied");
    const { result } = renderHook(() => useAnalytics(), { wrapper });
    result.current(AnalyticsEvent.BeginCheckout, {
      itemCount: 2,
      subtotal: 40,
    });
    expect(track).not.toHaveBeenCalled();
  });

  it("forwards the event name and properties once consent is granted", () => {
    localStorage.setItem(STORAGE_KEY, "granted");
    const { result } = renderHook(() => useAnalytics(), { wrapper });
    result.current(AnalyticsEvent.Purchase, { total: 120, kind: "shop" });
    expect(track).toHaveBeenCalledWith("purchase", {
      total: 120,
      kind: "shop",
    });
  });

  it("supports an event with no properties", () => {
    localStorage.setItem(STORAGE_KEY, "granted");
    const { result } = renderHook(() => useAnalytics(), { wrapper });
    result.current(AnalyticsEvent.OrderFormStart);
    expect(track).toHaveBeenCalledWith("order_form_start", undefined);
  });
});
