import { describe, it, expect, vi } from "vitest";
import type Stripe from "stripe";
import { createDiscountCode } from "../../src/lib/stripe/promotions.js";

/** A fake Stripe exposing just the coupon/promotion-code calls the module uses. */
function fakeStripe(
  overrides: {
    listData?: unknown[];
    couponCreate?: ReturnType<typeof vi.fn>;
    promoCreate?: ReturnType<typeof vi.fn>;
    promoList?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const couponCreate =
    overrides.couponCreate ?? vi.fn().mockResolvedValue({ id: "coupon_1" });
  const promoCreate =
    overrides.promoCreate ?? vi.fn().mockResolvedValue({ id: "promo_1" });
  const promoList =
    overrides.promoList ??
    vi.fn().mockResolvedValue({ data: overrides.listData ?? [] });
  return {
    stripe: {
      coupons: { create: couponCreate },
      promotionCodes: { create: promoCreate, list: promoList },
    } as unknown as Stripe,
    couponCreate,
    promoCreate,
    promoList,
  };
}

describe("createDiscountCode", () => {
  it("creates a fixed-amount, single-use coupon + promo code with a minimum and expiry", async () => {
    const { stripe, couponCreate, promoCreate } = fakeStripe();

    const code = await createDiscountCode(stripe, {
      code: "AA-CREDIT-ABC123",
      name: "Referral credit",
      idempotencySeed: "credit:client-1",
      amountOffDollars: 40,
      maxRedemptions: 1,
      expiresInDays: 90,
      minimumAmountDollars: 40,
    });

    expect(code).toBe("AA-CREDIT-ABC123");

    expect(couponCreate).toHaveBeenCalledOnce();
    const [couponParams, couponOpts] = couponCreate.mock.calls[0];
    expect(couponParams).toMatchObject({
      amount_off: 4000,
      currency: "usd",
      duration: "once",
      name: "Referral credit",
    });
    expect(couponParams).not.toHaveProperty("percent_off");
    expect(couponOpts).toEqual({ idempotencyKey: "coupon:credit:client-1" });

    expect(promoCreate).toHaveBeenCalledOnce();
    const [promoParams, promoOpts] = promoCreate.mock.calls[0];
    expect(promoParams).toMatchObject({
      promotion: { type: "coupon", coupon: "coupon_1" },
      code: "AA-CREDIT-ABC123",
      max_redemptions: 1,
      restrictions: { minimum_amount: 4000, minimum_amount_currency: "usd" },
    });
    expect(typeof promoParams.expires_at).toBe("number");
    expect(promoOpts).toEqual({ idempotencyKey: "promo:credit:client-1" });
  });

  it("creates a percentage, standing (unlimited, no-expiry) code", async () => {
    const { stripe, couponCreate, promoCreate } = fakeStripe();

    await createDiscountCode(stripe, {
      code: "AA-AGAIN-XYZ789",
      name: "Returning skater",
      idempotencySeed: "returning:client-2",
      percentOff: 10,
    });

    expect(couponCreate.mock.calls[0][0]).toMatchObject({
      percent_off: 10,
      duration: "once",
    });
    expect(couponCreate.mock.calls[0][0]).not.toHaveProperty("amount_off");

    const promoParams = promoCreate.mock.calls[0][0];
    expect(promoParams).not.toHaveProperty("max_redemptions");
    expect(promoParams).not.toHaveProperty("expires_at");
    expect(promoParams).not.toHaveProperty("restrictions");
  });

  it("short-circuits (creates nothing) when the code already exists", async () => {
    const { stripe, couponCreate, promoCreate } = fakeStripe({
      listData: [{ id: "promo_existing", code: "AA-CREDIT-ABC123" }],
    });

    const code = await createDiscountCode(stripe, {
      code: "AA-CREDIT-ABC123",
      name: "Referral credit",
      idempotencySeed: "credit:client-1",
      amountOffDollars: 40,
    });

    expect(code).toBe("AA-CREDIT-ABC123");
    expect(couponCreate).not.toHaveBeenCalled();
    expect(promoCreate).not.toHaveBeenCalled();
  });

  it("treats a resource_already_exists on the promo create as success", async () => {
    const alreadyExists = Object.assign(new Error("exists"), {
      code: "resource_already_exists",
    });
    // Subclass check in the module is `instanceof Stripe.errors.StripeError`;
    // emulate by making the thrown error pass that guard.
    const StripeMod = (await import("stripe")).default;
    Object.setPrototypeOf(
      alreadyExists,
      StripeMod.errors.StripeError.prototype,
    );

    const promoCreate = vi.fn().mockRejectedValue(alreadyExists);
    const { stripe } = fakeStripe({ promoCreate });

    const code = await createDiscountCode(stripe, {
      code: "AA-WELCOME-QQQ111",
      name: "Referral welcome",
      idempotencySeed: "welcome:client-3",
      percentOff: 10,
      maxRedemptions: 1,
    });

    expect(code).toBe("AA-WELCOME-QQQ111");
  });

  it("rethrows an unexpected Stripe error", async () => {
    const promoCreate = vi.fn().mockRejectedValue(new Error("card_declined"));
    const { stripe } = fakeStripe({ promoCreate });

    await expect(
      createDiscountCode(stripe, {
        code: "AA-X",
        name: "x",
        idempotencySeed: "x",
        percentOff: 10,
      }),
    ).rejects.toThrow(/card_declined/);
  });
});
