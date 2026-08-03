import { describe, it, expect, vi, afterEach } from "vitest";
import type { Request, Response } from "express";
import { isLikelySpam, spamFilter } from "../../src/middlewares/spam-filter.js";

afterEach(() => {
  delete process.env.SPAM_MIN_FILL_MS;
});

describe("isLikelySpam", () => {
  it("is false for a clean submission (empty honeypot, plausible timing)", () => {
    expect(isLikelySpam({ website: "", elapsedMs: 5000 })).toBe(false);
  });

  it("is false when both signals are absent (fail open)", () => {
    expect(isLikelySpam({})).toBe(false);
  });

  it("flags a filled honeypot", () => {
    expect(isLikelySpam({ website: "http://spam.example" })).toBe(true);
  });

  it("ignores a whitespace-only honeypot", () => {
    expect(isLikelySpam({ website: "   " })).toBe(false);
  });

  it("flags an implausibly fast submit", () => {
    expect(isLikelySpam({ elapsedMs: 200 })).toBe(true);
  });

  it("does not flag a slow-enough submit", () => {
    expect(isLikelySpam({ elapsedMs: 2000 })).toBe(false);
  });

  it("does not flag when timing is absent even if honeypot is empty", () => {
    expect(isLikelySpam({ website: "" })).toBe(false);
  });

  it("honours SPAM_MIN_FILL_MS from the environment", () => {
    process.env.SPAM_MIN_FILL_MS = "5000";
    expect(isLikelySpam({ elapsedMs: 3000 })).toBe(true);
    expect(isLikelySpam({ elapsedMs: 6000 })).toBe(false);
  });

  it("treats SPAM_MIN_FILL_MS=0 as disabling the timing check", () => {
    process.env.SPAM_MIN_FILL_MS = "0";
    expect(isLikelySpam({ elapsedMs: 0 })).toBe(false);
  });
});

function fakeRes() {
  const res = {
    locals: {} as Record<string, unknown>,
    statusCode: undefined as number | undefined,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

describe("spamFilter middleware", () => {
  const success = { status: 201, body: { success: true } };

  it("drops a spam body with the success-looking response and no next()", () => {
    const res = fakeRes();
    res.locals.body = { website: "x" };
    const next = vi.fn();

    spamFilter(success)(
      { ip: "1.2.3.4", path: "/contact" } as unknown as Request,
      res as unknown as Response,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual({ success: true });
  });

  it("passes a clean body through to next() without responding", () => {
    const res = fakeRes();
    res.locals.body = { website: "", elapsedMs: 5000 };
    const next = vi.fn();

    spamFilter(success)(
      { ip: "1.2.3.4", path: "/contact" } as unknown as Request,
      res as unknown as Response,
      next,
    );

    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBeUndefined();
    expect(res.body).toBeUndefined();
  });
});
