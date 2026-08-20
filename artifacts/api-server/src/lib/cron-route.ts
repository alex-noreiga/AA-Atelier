// Auth helpers for the two machine-facing endpoints that sit outside the OpenAPI
// contract and are gated by `CRON_SECRET`: the nightly milestone reconciliation
// (Vercel Cron) and the Notion stage-change automation webhook.
//
// This file used to be larger. It also held `htmlPage` / `escapeHtml` /
// `orderParam` — the shape of the atelier's "buttons": links carrying the shared
// secret in their query string, opened from a Notion formula property, rendering
// a small confirmation page in the tab they opened. Those buttons have been
// replaced by the signed-in studio dashboard (`POST /api/studio/tools/:tool`),
// so the only callers left are machines that can set a header, and what remains
// here is the two ways they authenticate.

import type { Request } from "express";

/** Authorized when `Authorization: Bearer <CRON_SECRET>` matches — the header
 * form used by Vercel Cron and the Notion automation (keeps the token out of the
 * URL and logs). False when `CRON_SECRET` is unset. */
export function hasCronBearer(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  return !!secret && req.headers.authorization === `Bearer ${secret}`;
}

/** Authorized when `?secret=<CRON_SECRET>` matches. The last place the app takes
 * the secret from a URL, kept only for a Notion stage-change automation already
 * configured that way — see routes/order-notification.ts. False when
 * `CRON_SECRET` is unset. */
export function hasCronQuerySecret(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  return !!secret && req.query.secret === secret;
}
