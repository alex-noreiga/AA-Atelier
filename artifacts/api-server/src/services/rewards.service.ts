// Referral & returning-skater rewards, independent of HTTP (roadmap "Referral &
// returning-skater rewards"). Everything here is BEST-EFFORT: it must never fail
// an order (`submitOrder`) or 500 the Stripe webhook — callers wrap it in
// try/catch, and every entry point also degrades to a no-op when the Client CRM
// or Stripe isn't configured. The CRM row is the source of truth; a lost
// best-effort email leaves the issued code stored on the row for the atelier to
// resend.
//
// Two mechanics, one engine:
//   • Referral (two-sided) — a new skater who orders with a referral code gets a
//     welcome discount now (at capture); the referrer earns a fixed-$ credit when
//     that order is first PAID (the webhook), gated by a `Referral Rewarded` flag.
//   • Returning-skater — a customer with a prior *different* paid order gets a
//     standing personal discount code, gated by `First Paid Order` (which order
//     was first — so a webhook retry or a later payment stage of the same order
//     can't trigger it) + a `Returning Reward Issued` flag.
//
// Idempotency is layered: the CRM flags above are the fast guard; Stripe's
// globally-unique promo `code` + per-reward `idempotencyKey` are the backstop
// (see lib/stripe/promotions.ts), so the webhook's at-least-once delivery can't
// double-issue.

import { createHash } from "node:crypto";
import type Stripe from "stripe";
import { getStripeClient } from "../lib/stripe/client.js";
import { createDiscountCode } from "../lib/stripe/promotions.js";
import {
  findClientByReferralCode,
  getClientRewardRowByEmail,
  patchClientProperties,
  CLIENT_REFERRAL_CODE_PROPERTY,
  CLIENT_REFERRED_BY_PROPERTY,
  CLIENT_REFERRAL_REWARDED_PROPERTY,
  CLIENT_FIRST_PAID_ORDER_PROPERTY,
  CLIENT_RETURNING_REWARD_ISSUED_PROPERTY,
  CLIENT_REFERRAL_CREDIT_CODE_PROPERTY,
  CLIENT_RETURNING_DISCOUNT_CODE_PROPERTY,
  type ClientRewardRow,
} from "../lib/notion/clients.repository.js";
import {
  referralWelcomeEmail,
  referralCreditEmail,
  returningSkaterRewardEmail,
} from "../lib/resend/emails.js";
import { sendEmailBestEffort } from "../lib/resend/send.js";
import { fromAddress } from "../lib/resend/config.js";
import { settingValue } from "../lib/settings/store.js";
import { normalizeEmail } from "../lib/email.js";
import { logger } from "../lib/logger.js";

const DEFAULT_REFERRAL_CREDIT_AMOUNT = 40;
const DEFAULT_WELCOME_PERCENT = 10;
const DEFAULT_RETURNING_PERCENT = 10;
const DEFAULT_REWARD_CODE_EXPIRES_DAYS = 90;

/** Parse a numeric setting (Studio Settings → env → default), rejecting a
 * non-finite / out-of-range value. `max` bounds a percentage at 100. */
function numericSetting(
  key: string,
  fallback: number,
  { min = 0, max = Infinity }: { min?: number; max?: number } = {},
): number {
  const raw = settingValue(key) ?? process.env[key];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max
    ? parsed
    : fallback;
}

/** The referral credit, in dollars, a referred skater's first paid order earns
 * the referrer. `0` disables the referrer credit. */
export function referralCreditAmount(): number {
  return numericSetting(
    "REFERRAL_CREDIT_AMOUNT",
    DEFAULT_REFERRAL_CREDIT_AMOUNT,
  );
}

/** The new-skater welcome discount, as a whole-number percentage (0–100). */
export function welcomeDiscountPercent(): number {
  return numericSetting("REFERRAL_WELCOME_PERCENT", DEFAULT_WELCOME_PERCENT, {
    max: 100,
  });
}

/** The standing returning-customer discount, as a whole-number percentage. */
export function returningDiscountPercent(): number {
  return numericSetting(
    "RETURNING_DISCOUNT_PERCENT",
    DEFAULT_RETURNING_PERCENT,
    { max: 100 },
  );
}

/** How many days an issued (one-time) reward code stays redeemable. */
export function rewardCodeExpiresDays(): number {
  return numericSetting(
    "REWARD_CODE_EXPIRES_DAYS",
    DEFAULT_REWARD_CODE_EXPIRES_DAYS,
    { min: 1 },
  );
}

// Unambiguous alphabet (no 0/O/1/I) for human-readable, deterministic codes.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** A short, stable, uppercase code fragment derived from a seed. Deterministic
 * so a re-run produces the same customer-facing code (which is itself the
 * Stripe-level dedupe key). */
function shortHash(seed: string, len: number): string {
  const digest = createHash("sha256").update(seed).digest();
  let out = "";
  for (let i = 0; i < len; i++) {
    out += CODE_ALPHABET[digest[i] % CODE_ALPHABET.length];
  }
  return out;
}

/** The Stripe client, or null when STRIPE_SECRET_KEY is unset (so reward code
 * creation self-gates off rather than throwing). */
function stripeOrNull(): Stripe | null {
  try {
    return getStripeClient();
  } catch {
    return null;
  }
}

function richTextProp(value: string): {
  rich_text: Array<{ text: { content: string } }>;
} {
  return { rich_text: [{ text: { content: value } }] };
}

const ORDERS_FROM = () => fromAddress("orders");

/** The customer's referral-program state for the account dashboard. */
export interface ReferralInfo {
  code: string;
  creditAmount: number;
  returningCode?: string;
}

/**
 * The customer's referral code, generating + persisting one on first read.
 * Returns null when the CRM is unconfigured or no client row exists yet (a
 * customer who has never ordered / been captured). Best-effort — a CRM hiccup
 * yields null so the dashboard's referral card simply doesn't render.
 */
export async function ensureReferralCode(
  email: string,
): Promise<ReferralInfo | null> {
  let row: ClientRewardRow | null;
  try {
    row = await getClientRewardRowByEmail(email);
  } catch (err) {
    logger.warn(
      { err },
      "Rewards: could not read the client row for referral code",
    );
    return null;
  }
  if (!row) return null;

  let code = row.referralCode;
  if (!code) {
    code = `AA-${shortHash(`referral:${normalizeEmail(email)}`, 6)}`;
    try {
      await patchClientProperties(row.pageId, {
        [CLIENT_REFERRAL_CODE_PROPERTY]: richTextProp(code),
      });
    } catch (err) {
      // The code is deterministic, so a failed persist just regenerates the same
      // value next time — still safe to show now.
      logger.warn({ err }, "Rewards: could not persist a new referral code");
    }
  }

  return {
    code,
    creditAmount: referralCreditAmount(),
    ...(row.returningDiscountCode
      ? { returningCode: row.returningDiscountCode }
      : {}),
  };
}

export interface CaptureReferralInput {
  /** The referral code the new customer entered (may be blank/absent). */
  referralCode?: string;
  /** The new customer's email. */
  email: string;
}

/**
 * Capture a referral at order placement: stamp the new customer's CRM row with
 * the referrer's email and issue + email their welcome discount. Best-effort and
 * fail-soft — an unknown code, a self-referral, an already-captured customer, or
 * a missing CRM/Stripe all no-op without touching the order. The referrer's own
 * credit is NOT issued here; it fires on this order's first payment
 * (`runPaidOrderRewards`).
 */
export async function captureReferralOnOrder(
  input: CaptureReferralInput,
): Promise<void> {
  const code = input.referralCode?.trim();
  if (!code) return;

  const row = await getClientRewardRowByEmail(input.email);
  if (!row) return; // CRM unconfigured or the client row isn't there yet
  if (row.referredByEmail) return; // already captured — don't re-stamp / re-email

  const referrer = await findClientByReferralCode(code);
  if (!referrer) return; // unknown code
  if (normalizeEmail(referrer.email) === normalizeEmail(input.email)) return; // self-referral

  // Stamp the referrer link first, so the credit can fire on payment even if the
  // welcome-code step below fails.
  await patchClientProperties(row.pageId, {
    [CLIENT_REFERRED_BY_PROPERTY]: richTextProp(normalizeEmail(referrer.email)),
  });

  const stripe = stripeOrNull();
  if (!stripe) return;
  const percent = welcomeDiscountPercent();
  if (percent <= 0) return;

  const welcomeCode = `AA-WELCOME-${shortHash(`welcome:${row.pageId}`, 6)}`;
  await createDiscountCode(stripe, {
    code: welcomeCode,
    name: "Referral welcome",
    idempotencySeed: `welcome:${row.pageId}`,
    percentOff: percent,
    maxRedemptions: 1,
    expiresInDays: rewardCodeExpiresDays(),
  });
  await sendEmailBestEffort({
    ...referralWelcomeEmail({ email: input.email, code: welcomeCode, percent }),
    from: ORDERS_FROM(),
  });
}

/**
 * Run the on-payment reward passes for a paid order (custom or shop). Called
 * from both Stripe webhook recorders. Reads the payer's CRM row once, then runs
 * the referrer-credit and returning-skater passes independently (one failing
 * never skips the other). No-op when the CRM is unconfigured or no row exists.
 *
 * @param email       the paying customer's email
 * @param orderNumber the order's human-readable number (ORD-… / SHP-…), used to
 *                    make the returning-reward trigger idempotent by order.
 */
export async function runPaidOrderRewards(
  email: string,
  orderNumber: string,
): Promise<void> {
  const row = await getClientRewardRowByEmail(email);
  if (!row) return;

  for (const pass of [
    () => issueReferrerCredit(row),
    () => issueReturningReward(row, orderNumber),
  ]) {
    try {
      await pass();
    } catch (err) {
      logger.warn({ err }, "Rewards: an on-payment reward pass failed");
    }
  }
}

/**
 * Credit the referrer when a referred customer's order is first paid. Guarded by
 * the `Referral Rewarded` flag on the referred customer's row, so it fires once
 * regardless of how many payments/retries the order sees.
 */
async function issueReferrerCredit(row: ClientRewardRow): Promise<void> {
  if (!row.referredByEmail || row.referralRewarded) return;

  const amount = referralCreditAmount();
  if (amount <= 0) return;
  const stripe = stripeOrNull();
  if (!stripe) return;

  const code = `AA-CREDIT-${shortHash(`credit:${row.pageId}`, 6)}`;
  await createDiscountCode(stripe, {
    code,
    name: "Referral credit",
    idempotencySeed: `credit:${row.pageId}`,
    amountOffDollars: amount,
    maxRedemptions: 1,
    expiresInDays: rewardCodeExpiresDays(),
    // Don't let a large fixed credit be burned on a tiny order (a fixed
    // amount_off caps at the order total).
    minimumAmountDollars: amount,
  });

  // Set the guard + store the code (audit/resend) BEFORE the best-effort email,
  // so a lost email doesn't cause a re-issue and the atelier can resend by hand.
  await patchClientProperties(row.pageId, {
    [CLIENT_REFERRAL_REWARDED_PROPERTY]: { checkbox: true },
    [CLIENT_REFERRAL_CREDIT_CODE_PROPERTY]: richTextProp(code),
  });
  await sendEmailBestEffort({
    ...referralCreditEmail({ email: row.referredByEmail, code, amount }),
    from: ORDERS_FROM(),
  });
}

/**
 * Give a returning customer a standing personal discount on their second
 * distinct paid order. `First Paid Order` records which order was their first
 * (idempotent against retries / later payment stages of the same order); a
 * different order number with the reward not yet issued triggers it.
 */
async function issueReturningReward(
  row: ClientRewardRow,
  orderNumber: string,
): Promise<void> {
  if (!row.firstPaidOrder) {
    // First paid order: record it, no reward yet.
    await patchClientProperties(row.pageId, {
      [CLIENT_FIRST_PAID_ORDER_PROPERTY]: richTextProp(orderNumber),
    });
    return;
  }
  if (row.firstPaidOrder === orderNumber) return; // same order (retry / later stage)
  if (row.returningRewardIssued) return; // already has a standing code

  const percent = returningDiscountPercent();
  if (percent <= 0) return;
  const stripe = stripeOrNull();
  if (!stripe) return;

  // Standing = reusable (no max_redemptions) and no expiry.
  const code = `AA-AGAIN-${shortHash(`returning:${row.pageId}`, 6)}`;
  await createDiscountCode(stripe, {
    code,
    name: "Returning skater",
    idempotencySeed: `returning:${row.pageId}`,
    percentOff: percent,
  });

  await patchClientProperties(row.pageId, {
    [CLIENT_RETURNING_REWARD_ISSUED_PROPERTY]: { checkbox: true },
    [CLIENT_RETURNING_DISCOUNT_CODE_PROPERTY]: richTextProp(code),
  });
  await sendEmailBestEffort({
    ...returningSkaterRewardEmail({ email: row.email, code, percent }),
    from: ORDERS_FROM(),
  });
}
