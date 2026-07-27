import { describe, it, expect } from "vitest";
import { parseCookies, SESSION_COOKIE } from "../../src/lib/auth/cookies.js";

describe("parseCookies", () => {
  it("parses a name→value map and URL-decodes values", () => {
    const cookies = parseCookies(
      `${SESSION_COOKIE}=abc.def; theme=dark%20mode`,
    );
    expect(cookies[SESSION_COOKIE]).toBe("abc.def");
    expect(cookies.theme).toBe("dark mode");
  });

  it("returns an empty map for a missing header", () => {
    expect(Object.keys(parseCookies(undefined))).toHaveLength(0);
  });

  it("drops prototype-polluting cookie names and never pollutes Object.prototype", () => {
    const cookies = parseCookies(
      "__proto__=polluted; constructor=x; prototype=y",
    );
    expect(cookies.__proto__).toBeUndefined();
    // The real assertion: no object anywhere gained a "polluted" property.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty("polluted");
  });
});
