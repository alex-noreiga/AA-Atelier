import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The client memoises one Stripe instance and reads the secret key at first use,
// so each test re-imports the module for a clean singleton and restores env.
let mod: typeof import("../../src/lib/stripe/client.js");
let saved: string | undefined;

beforeEach(async () => {
  saved = process.env.STRIPE_SECRET_KEY;
  vi.resetModules();
  mod = await import("../../src/lib/stripe/client.js");
});

afterEach(() => {
  if (saved === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = saved;
});

describe("getStripeClient", () => {
  it("throws when STRIPE_SECRET_KEY is not set", () => {
    delete process.env.STRIPE_SECRET_KEY;
    expect(() => mod.getStripeClient()).toThrow(
      /STRIPE_SECRET_KEY environment variable is not set/,
    );
  });

  it("constructs a client when the key is set and memoises it", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_123";
    const first = mod.getStripeClient();
    expect(first).toBeDefined();
    // Second call returns the same cached instance.
    expect(mod.getStripeClient()).toBe(first);
  });
});
