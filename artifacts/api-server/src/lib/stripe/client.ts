// Thin lazily-constructed Stripe client. The secret key is read at first use
// (not at module load), mirroring the Notion client in `lib/notion/client.ts`,
// so the server — and the tests — can import this module without credentials.
// Tests inject their own fake client instead of calling `getStripeClient()`.
//
// Get keys at https://dashboard.stripe.com/apikeys. Use test-mode keys locally.

import Stripe from "stripe";

let client: Stripe | null = null;

export function getStripeClient(): Stripe {
  if (!client) {
    const apiKey = process.env.STRIPE_SECRET_KEY;
    if (!apiKey) {
      throw new Error("STRIPE_SECRET_KEY environment variable is not set");
    }
    client = new Stripe(apiKey);
  }
  return client;
}
