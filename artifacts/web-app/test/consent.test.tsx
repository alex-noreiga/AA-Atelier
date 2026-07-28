import { describe, it, expect, beforeEach } from "vitest";
import { render, renderHook, act } from "@testing-library/react";
import { ConsentProvider, useConsent } from "@/lib/consent";

const STORAGE_KEY = "aa-cookie-consent";

function wrapper({ children }: { children: React.ReactNode }) {
  return <ConsentProvider>{children}</ConsentProvider>;
}

beforeEach(() => localStorage.clear());

describe("consent context", () => {
  it("starts 'unset' when nothing is stored", () => {
    const { result } = renderHook(() => useConsent(), { wrapper });
    expect(result.current.status).toBe("unset");
  });

  it("hydrates a stored choice", () => {
    localStorage.setItem(STORAGE_KEY, "granted");
    const { result } = renderHook(() => useConsent(), { wrapper });
    expect(result.current.status).toBe("granted");
  });

  it("ignores a garbage stored value", () => {
    localStorage.setItem(STORAGE_KEY, "maybe");
    const { result } = renderHook(() => useConsent(), { wrapper });
    expect(result.current.status).toBe("unset");
  });

  it("grant() opts in and persists", () => {
    const { result } = renderHook(() => useConsent(), { wrapper });
    act(() => result.current.grant());
    expect(result.current.status).toBe("granted");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("granted");
  });

  it("deny() opts out and persists", () => {
    const { result } = renderHook(() => useConsent(), { wrapper });
    act(() => result.current.deny());
    expect(result.current.status).toBe("denied");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("denied");
  });

  it("reset() clears the stored choice so the visitor is asked again", () => {
    localStorage.setItem(STORAGE_KEY, "denied");
    const { result } = renderHook(() => useConsent(), { wrapper });
    act(() => result.current.reset());
    expect(result.current.status).toBe("unset");
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("throws when used outside a provider", () => {
    // Silence the expected React error boundary logging noise.
    function Bare() {
      useConsent();
      return null;
    }
    expect(() => render(<Bare />)).toThrow(
      /useConsent must be used within a ConsentProvider/,
    );
  });
});
