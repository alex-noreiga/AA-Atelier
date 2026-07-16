// The Stripe webhook is intentionally NOT part of the OpenAPI contract or the
// generated client: it's a Stripe -> server contract, not a browser-facing API.
// It needs the RAW request body to verify the signature, so it's registered
// directly on the Express app in `app.ts` with `express.raw()` — before the
// global `express.json()` parser — and bypasses the zod-validate middleware.

import type { Request, Response } from "express";
import type Stripe from "stripe";
import { getStripeClient } from "../lib/stripe/client.js";
import { recordPaidOrder } from "../services/checkout.service.js";
import {
  CUSTOM_PAYMENT_KIND,
  recordPayment,
} from "../services/invoice.service.js";
import { logger } from "../lib/logger.js";

export async function stripeWebhookHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const signature = req.headers["stripe-signature"];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || typeof signature !== "string") {
    res.status(400).send("Missing Stripe signature or webhook secret");
    return;
  }

  let event: Stripe.Event;
  try {
    // `req.body` is a Buffer here thanks to express.raw() on this route.
    event = getStripeClient().webhooks.constructEvent(
      req.body,
      signature,
      secret,
    );
  } catch (err) {
    logger.warn({ err }, "Stripe webhook signature verification failed");
    res.status(400).send("Webhook signature verification failed");
    return;
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    try {
      // Route by metadata.kind: a custom_payment session marks the paid stage
      // (first deposit, second deposit, or balance) on the order's invoice, and
      // any other completed session is a shop-cart order. Both recorders are
      // idempotent, so Stripe's retries on a 500 are safe.
      if (session.metadata?.kind === CUSTOM_PAYMENT_KIND) {
        await recordPayment(session);
      } else {
        await recordPaidOrder(session);
      }
    } catch (err) {
      logger.error({ err }, "Failed to record completed checkout session");
      res.status(500).json({ received: false });
      return;
    }
  }

  res.json({ received: true });
}
