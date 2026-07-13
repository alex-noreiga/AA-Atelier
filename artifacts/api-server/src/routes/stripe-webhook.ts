// The Stripe webhook is intentionally NOT part of the OpenAPI contract or the
// generated client: it's a Stripe -> server contract, not a browser-facing API.
// It needs the RAW request body to verify the signature, so it's registered
// directly on the Express app in `app.ts` with `express.raw()` — before the
// global `express.json()` parser — and bypasses the zod-validate middleware.

import type { Request, Response } from "express";
import type Stripe from "stripe";
import { getStripeClient } from "../lib/stripe/client.js";
import { recordPaidOrder } from "../services/checkout.service.js";
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
    try {
      await recordPaidOrder(event.data.object as Stripe.Checkout.Session);
    } catch (err) {
      // Return 500 so Stripe retries the delivery — recordPaidOrder dedupes on
      // the session id, so replaying a succeeded delivery is safe.
      logger.error({ err }, "Failed to record paid shop order");
      res.status(500).json({ received: false });
      return;
    }
  }

  res.json({ received: true });
}
