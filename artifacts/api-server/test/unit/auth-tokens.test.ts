import { describe, it, expect, afterEach } from "vitest";
import {
  signToken,
  verifyToken,
  authConfigured,
  MAGIC_LINK_TTL_SECONDS,
} from "../../src/lib/auth/tokens.js";

// The setup file sets SESSION_SECRET; restore it after any test that changes it.
const SECRET = process.env.SESSION_SECRET;
afterEach(() => {
  process.env.SESSION_SECRET = SECRET;
});

describe("auth tokens", () => {
  it("signs and verifies a token, returning the email", () => {
    const token = signToken(
      "skater@example.com",
      "magic",
      MAGIC_LINK_TTL_SECONDS,
    );
    expect(verifyToken(token, "magic")).toEqual({
      email: "skater@example.com",
    });
  });

  it("rejects a token verified against the wrong purpose", () => {
    const token = signToken("a@b.com", "magic", MAGIC_LINK_TTL_SECONDS);
    expect(verifyToken(token, "session")).toBeNull();
  });

  it("rejects an expired token", () => {
    const token = signToken("a@b.com", "session", -1);
    expect(verifyToken(token, "session")).toBeNull();
  });

  it("rejects a token with a tampered signature", () => {
    const token = signToken("a@b.com", "magic", MAGIC_LINK_TTL_SECONDS);
    const [payload] = token.split(".");
    expect(verifyToken(`${payload}.deadbeef`, "magic")).toBeNull();
  });

  it("rejects a token whose payload was altered after signing", () => {
    const token = signToken("a@b.com", "magic", MAGIC_LINK_TTL_SECONDS);
    const [, sig] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({
        email: "attacker@evil.com",
        purpose: "magic",
        exp: Math.floor(Date.now() / 1000) + 999,
      }),
    ).toString("base64url");
    expect(verifyToken(`${forged}.${sig}`, "magic")).toBeNull();
  });

  it("rejects malformed and empty tokens", () => {
    expect(verifyToken("", "magic")).toBeNull();
    expect(verifyToken("nodot", "magic")).toBeNull();
    expect(verifyToken(undefined, "magic")).toBeNull();
  });

  it("does not cross-verify tokens signed under a different secret", () => {
    const token = signToken("a@b.com", "magic", MAGIC_LINK_TTL_SECONDS);
    process.env.SESSION_SECRET = "a-different-secret";
    expect(verifyToken(token, "magic")).toBeNull();
  });

  it("is inert when SESSION_SECRET is unset", () => {
    delete process.env.SESSION_SECRET;
    expect(authConfigured()).toBe(false);
    expect(() =>
      signToken("a@b.com", "magic", MAGIC_LINK_TTL_SECONDS),
    ).toThrow();
    expect(verifyToken("anything.anything", "magic")).toBeNull();
  });
});
