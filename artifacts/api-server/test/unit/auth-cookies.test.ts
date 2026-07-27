import { describe, it, expect } from "vitest";
import { parseCookies, SESSION_COOKIE } from "../../src/lib/auth/cookies.js";

describe("parseCookies", () => {
  it("parses a name→value Map and URL-decodes values", () => {
    const cookies = parseCookies(
      `${SESSION_COOKIE}=abc.def; theme=dark%20mode`,
    );
    expect(cookies.get(SESSION_COOKIE)).toBe("abc.def");
    expect(cookies.get("theme")).toBe("dark mode");
  });

  it("returns an empty Map for a missing header", () => {
    expect(parseCookies(undefined).size).toBe(0);
  });

  it("stores hostile cookie names as isolated Map entries without polluting Object.prototype", () => {
    const cookies = parseCookies(
      "__proto__=polluted; constructor=x; prototype=y",
    );
    // A Map keeps these as ordinary, isolated entries — no object anywhere is
    // affected, so no prototype pollution / property injection.
    expect(cookies.get("__proto__")).toBe("polluted");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty("polluted");
  });
});
