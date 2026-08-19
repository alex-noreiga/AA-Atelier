// Order status-change notification endpoint. Like the Stripe webhook and the
// milestone cron, it's a machine/atelier -> server endpoint, deliberately NOT
// part of the OpenAPI contract or the generated client, so it's mounted directly
// on the app (see app.ts) rather than in the /api router.
//
// One trigger: POST /api/webhooks/notion-stage-change — a Notion database
// automation ("when Stage changes, send webhook"). Notion's default payload
// carries the triggering page under `data.id`, so no hand-authored body is
// needed; if an authored body `{ "orderNumber": "…" }` is present it's preferred.
//
// The `…/run` link that used to sit alongside it — the atelier's way to send or
// re-send one order's update by hand — is gone. That job now belongs to the
// signed-in studio dashboard (`POST /api/studio/tools/status-email`, which also
// carries the `force` resend), so a per-order button no longer means a formula
// property with the shared secret baked into its URL.
//
// Auth reuses `CRON_SECRET`, accepted two ways: an `Authorization: Bearer
// <CRON_SECRET>` header (preferred — keeps the token out of the URL, referrers,
// and logs; use it on the Notion automation, which supports custom headers) OR a
// `?secret=<CRON_SECRET>` query token. The query form is kept only because a
// live automation may already be configured with it; it is the one remaining
// place the app accepts the secret in a URL, and the automation should use the
// header. The request logger strips the query string, so the token isn't logged.
//
// The POST is mounted with `express.raw` (see app.ts), so its body arrives as a
// Buffer we JSON-parse here — this way it's read regardless of the Content-Type
// Notion sends (its webhook action won't let you set a Content-Type header).

import type { Request, Response } from "express";
import {
  notifyOrderStageChange,
  type OrderLocator,
} from "../services/order-notification.service.js";
import { hasCronBearer, hasCronQuerySecret } from "../lib/cron-route.js";
import { logger } from "../lib/logger.js";

/** Authorized when the Bearer header OR the ?secret= query matches CRON_SECRET. */
function isAuthorized(req: Request): boolean {
  return hasCronBearer(req) || hasCronQuerySecret(req);
}

/**
 * The request body as an object, tolerant of how it arrived: the POST route is
 * mounted with `express.raw`, so `req.body` is a Buffer we JSON-parse here (this
 * is what lets us read it whatever Content-Type Notion used); the GET route has
 * no body, so `req.body` is already a (possibly empty) object. A non-JSON or
 * empty body yields `{}` rather than throwing.
 */
function bodyObject(req: Request): {
  orderNumber?: unknown;
  data?: { id?: unknown };
} {
  const raw: unknown = req.body;
  if (Buffer.isBuffer(raw)) {
    const text = raw.toString("utf8").trim();
    if (!text) return {};
    try {
      return JSON.parse(text) as {
        orderNumber?: unknown;
        data?: { id?: unknown };
      };
    } catch {
      return {};
    }
  }
  if (raw && typeof raw === "object") {
    return raw as { orderNumber?: unknown; data?: { id?: unknown } };
  }
  return {};
}

/**
 * Locate the order to notify. Prefers an explicit order number — an authored body
 * `{ orderNumber }` or an `?order=` param. Otherwise falls back to the Notion
 * automation's default payload, which carries the triggering page under `data.id`
 * (so the atelier doesn't have to hand-author a webhook body). Returns null when
 * neither is present.
 */
function locatorFrom(req: Request): OrderLocator | null {
  const body = bodyObject(req);
  const fromBody = typeof body.orderNumber === "string" ? body.orderNumber : "";
  const fromQuery = typeof req.query.order === "string" ? req.query.order : "";
  const orderNumber = (fromBody || fromQuery).trim();
  if (orderNumber) return { orderNumber };

  const pageId = typeof body.data?.id === "string" ? body.data.id.trim() : "";
  if (pageId) return { pageId };

  return null;
}

/** Notion automation webhook (POST, JSON). */
export async function notionStageChangeHandler(
  req: Request,
  res: Response,
): Promise<void> {
  if (!isAuthorized(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const locator = locatorFrom(req);
  if (!locator) {
    res.status(400).json({ error: "Missing order number or page id" });
    return;
  }

  try {
    const result = await notifyOrderStageChange(locator);
    logger.info(result, "Order status-change webhook processed");
    res.json(result);
  } catch (err) {
    logger.error({ err, locator }, "Order status-change webhook failed");
    res.status(500).json({ error: "Internal error" });
  }
}
