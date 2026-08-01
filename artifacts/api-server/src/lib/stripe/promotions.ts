// Programmatic Stripe promotion codes for the referral / returning-skater
// rewards (see services/rewards.service.ts). Kept out of rewards.service so the
// Stripe shape is isolated and testable with an injected fake Stripe.
//
// Model: a Stripe *Coupon* holds the discount math (a fixed amount off or a
// percentage); a *Promotion Code* is the customer-facing string that points at
// a coupon. Redemption needs no code here — `allow_promotion_codes: true` is
// already set on all three Checkout paths (shop cart, custom deposit, custom
// balance), so the hosted page shows a redemption box and applies the code.
//
// Idempotency has two layers, both load-bearing given the Stripe webhook's
// at-least-once delivery: an `idempotencyKey` on each create call (dedupes a
// retry within Stripe's 24h window) and the promotion `code` itself, which is
// globally unique per Stripe account — a re-create with the same code throws
// `resource_already_exists`, which we treat as "already issued". A pre-check by
// code short-circuits before creating a coupon, so a re-run leaves no orphan
// coupon behind.

import Stripe from "stripe";

const CURRENCY = "usd";

export interface DiscountCodeSpec {
  /** The human-readable, globally-unique promotion code (also the dedupe key). */
  code: string;
  /** Coupon display name in the Stripe dashboard, e.g. "Referral credit". */
  name: string;
  /**
   * Idempotency seed, namespaced per reward + recipient (e.g. the referred
   * client's page id), so a webhook retry reuses the same coupon/promo instead
   * of minting a duplicate.
   */
  idempotencySeed: string;
  /** A fixed dollars-off credit. Mutually exclusive with `percentOff`. */
  amountOffDollars?: number;
  /** A percentage off (0–100). Mutually exclusive with `amountOffDollars`. */
  percentOff?: number;
  /**
   * Caps redemptions; omit for an unlimited/standing code (the returning-skater
   * perk). A one-time credit/welcome code passes `1`.
   */
  maxRedemptions?: number;
  /** Days until the code expires; omit for no expiry. */
  expiresInDays?: number;
  /**
   * Minimum order total (dollars) the code applies to. Guards a fixed-amount
   * credit from being burned on a tiny order (a fixed `amount_off` caps at the
   * order total, so a $40 credit on a $5 order would waste $35 of it).
   */
  minimumAmountDollars?: number;
}

/** Unix seconds `days` from now, for a promotion code's `expires_at`. */
function unixInDays(days: number): number {
  return Math.floor(Date.now() / 1000) + Math.round(days * 86_400);
}

function isAlreadyExists(err: unknown): boolean {
  return (
    err instanceof Stripe.errors.StripeError &&
    err.code === "resource_already_exists"
  );
}

/**
 * Create (or reuse) a promotion code for one reward. Returns the code string.
 * Idempotent: an already-existing code — from a prior run or a webhook retry —
 * is returned as-is without creating a duplicate coupon.
 */
export async function createDiscountCode(
  stripe: Stripe,
  spec: DiscountCodeSpec,
): Promise<string> {
  // Short-circuit if this exact code already exists, so a re-run never orphans a
  // fresh coupon behind a promo-code uniqueness clash.
  const existing = await stripe.promotionCodes.list({
    code: spec.code,
    limit: 1,
  });
  if (existing.data.length > 0) {
    return spec.code;
  }

  const couponParams: Stripe.CouponCreateParams =
    typeof spec.amountOffDollars === "number"
      ? {
          amount_off: Math.round(spec.amountOffDollars * 100),
          currency: CURRENCY,
          duration: "once",
          name: spec.name,
        }
      : {
          percent_off: spec.percentOff ?? 0,
          duration: "once",
          name: spec.name,
        };

  let coupon: Stripe.Coupon;
  try {
    coupon = await stripe.coupons.create(couponParams, {
      idempotencyKey: `coupon:${spec.idempotencySeed}`,
    });
  } catch (err) {
    // A racing create under the same idempotency key: fall through to the promo
    // create, which will surface the existing code.
    if (!isAlreadyExists(err)) throw err;
    // Without the coupon object we can't create the promo; the code was already
    // minted by the racing call, so report it as issued.
    return spec.code;
  }

  const promoParams: Stripe.PromotionCodeCreateParams = {
    promotion: { type: "coupon", coupon: coupon.id },
    code: spec.code,
    ...(typeof spec.maxRedemptions === "number"
      ? { max_redemptions: spec.maxRedemptions }
      : {}),
    ...(typeof spec.expiresInDays === "number"
      ? { expires_at: unixInDays(spec.expiresInDays) }
      : {}),
    ...(typeof spec.minimumAmountDollars === "number"
      ? {
          restrictions: {
            minimum_amount: Math.round(spec.minimumAmountDollars * 100),
            minimum_amount_currency: CURRENCY,
          },
        }
      : {}),
  };

  try {
    await stripe.promotionCodes.create(promoParams, {
      idempotencyKey: `promo:${spec.idempotencySeed}`,
    });
  } catch (err) {
    if (!isAlreadyExists(err)) throw err;
  }
  return spec.code;
}
