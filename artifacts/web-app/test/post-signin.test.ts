import { describe, it, expect, beforeEach } from "vitest";
import { setPostSignInPath, takePostSignInPath } from "@/lib/post-signin";

beforeEach(() => {
  window.sessionStorage.clear();
});

describe("post-sign-in destination", () => {
  it("round-trips a same-origin path", () => {
    setPostSignInPath("/studio");
    expect(takePostSignInPath()).toBe("/studio");
  });

  it("is consumed once, so a later sign-in lands at the default", () => {
    setPostSignInPath("/studio");
    expect(takePostSignInPath()).toBe("/studio");
    expect(takePostSignInPath()).toBeNull();
  });

  it("returns null when nothing was stored", () => {
    expect(takePostSignInPath()).toBeNull();
  });

  it("refuses to store an off-site destination", () => {
    // A protocol-relative URL is the one that bites: a router treats "//host"
    // as another origin, so it must never be stored or returned.
    for (const bad of [
      "//evil.example.com",
      "https://evil.example.com",
      "javascript:alert(1)",
      "studio",
      "",
    ]) {
      setPostSignInPath(bad);
      expect(takePostSignInPath()).toBeNull();
    }
  });

  it("refuses an off-site destination even if one is planted in storage", () => {
    window.sessionStorage.setItem("aa-post-signin", "//evil.example.com");
    expect(takePostSignInPath()).toBeNull();
  });
});
