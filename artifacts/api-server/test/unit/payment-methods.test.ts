import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { bnplPaymentMethodTypes } from "../../src/lib/stripe/payment-methods.js";
import { logger } from "../../src/lib/logger.js";

describe("bnplPaymentMethodTypes", () => {
  beforeEach(() => {
    delete process.env.STRIPE_BNPL_METHODS;
    // Silence (and let tests assert) the actionable misconfiguration logs.
    vi.spyOn(logger, "error").mockImplementation(() => logger);
  });

  afterEach(() => {
    delete process.env.STRIPE_BNPL_METHODS;
  });

  it("returns undefined when unset (⇒ dynamic payment methods, unchanged)", () => {
    expect(bnplPaymentMethodTypes()).toBeUndefined();
  });

  it("returns undefined for an empty / whitespace-only value", () => {
    process.env.STRIPE_BNPL_METHODS = "  ,  ";
    expect(bnplPaymentMethodTypes()).toBeUndefined();
  });

  it("prepends card to the configured BNPL methods, in order", () => {
    process.env.STRIPE_BNPL_METHODS = "klarna,affirm";
    expect(bnplPaymentMethodTypes()).toEqual(["card", "klarna", "affirm"]);
  });

  it("trims and lowercases entries", () => {
    process.env.STRIPE_BNPL_METHODS = " Klarna ,  AFFIRM ";
    expect(bnplPaymentMethodTypes()).toEqual(["card", "klarna", "affirm"]);
  });

  it("accepts the shared Afterpay/Clearpay id", () => {
    process.env.STRIPE_BNPL_METHODS = "afterpay_clearpay";
    expect(bnplPaymentMethodTypes()).toEqual(["card", "afterpay_clearpay"]);
  });

  it("de-dupes a repeated method", () => {
    process.env.STRIPE_BNPL_METHODS = "klarna,klarna";
    expect(bnplPaymentMethodTypes()).toEqual(["card", "klarna"]);
  });

  it("drops an unsupported/misspelled id and logs it, keeping the valid ones", () => {
    process.env.STRIPE_BNPL_METHODS = "klarna,paypal";
    expect(bnplPaymentMethodTypes()).toEqual(["card", "klarna"]);
    expect(logger.error).toHaveBeenCalled();
  });

  it("degrades to undefined (never card-less) when every id is invalid", () => {
    process.env.STRIPE_BNPL_METHODS = "paypal,nope";
    expect(bnplPaymentMethodTypes()).toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });
});
