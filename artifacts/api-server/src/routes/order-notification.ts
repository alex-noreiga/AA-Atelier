// Order status-change notification endpoint. Like the Stripe webhook and the
// milestone cron, it's a machine/atelier -> server endpoint, deliberately NOT
// part of the OpenAPI contract or the generated client, so it's mounted directly
// on the app (see app.ts) rather than in the /api router.
//
// Two triggers for the SAME send (`notifyOrderStageChange`):
//   1. POST /api/webhooks/notion-stage-change — a Notion database automation
//      ("when Stage changes, send webhook") POSTs `{ "orderNumber": "…" }`.
//   2. GET  /api/webhooks/notion-stage-change/run?order=<n> — a link the atelier
//      opens by hand to send an update on demand (and to test in production
//      against one order without wiring up the automation). Returns a small HTML
//      confirmation page for the tab it opens.
//
// Auth: both reuse `CRON_SECRET` as a `?secret=` query token — a Notion "Send
// webhook" action can set the URL but not custom headers, same tradeoff as the
// milestone button. The request logger strips the query string, so the token
// isn't logged; it's still visible in the automation config + browser history.

import type { Request, Response } from "express";
import { notifyOrderStageChange } from "../services/order-notification.service.js";
import { logger } from "../lib/logger.js";

/** The order number, from the POST body (Notion automation) or ?order= (link). */
function orderNumberFrom(req: Request): string {
  const body = req.body as { orderNumber?: unknown } | undefined;
  const fromBody =
    typeof body?.orderNumber === "string" ? body.orderNumber : "";
  const fromQuery = typeof req.query.order === "string" ? req.query.order : "";
  return (fromBody || fromQuery).trim();
}

/** Escape dynamic values before interpolating them into the HTML confirmation. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A minimal self-contained HTML confirmation page for the on-demand link tab. */
function htmlPage(title: string, message: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:ui-serif,Georgia,serif;background:#faf8f5;color:#2b2b2b}main{max-width:26rem;padding:2.5rem;text-align:center}h1{font-size:1.5rem;font-weight:500;margin:0 0 .75rem}p{color:#6b6b6b;line-height:1.5;margin:0}</style></head><body><main><h1>${title}</h1><p>${message}</p></main></body></html>`;
}

/** Notion automation webhook (POST, JSON). */
export async function notionStageChangeHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.query.secret !== secret) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const orderNumber = orderNumberFrom(req);
  if (!orderNumber) {
    res.status(400).json({ error: "Missing order number" });
    return;
  }

  try {
    const result = await notifyOrderStageChange(orderNumber);
    logger.info(result, "Order status-change webhook processed");
    res.json(result);
  } catch (err) {
    logger.error({ err, orderNumber }, "Order status-change webhook failed");
    res.status(500).json({ error: "Internal error" });
  }
}

/** On-demand / test trigger the atelier opens in a browser (GET, HTML page). */
export async function notionStageChangeButtonHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.query.secret !== secret) {
    res
      .status(401)
      .type("html")
      .send(
        htmlPage(
          "Not authorized",
          "This order-update link is missing a valid access token.",
        ),
      );
    return;
  }

  const orderNumber = orderNumberFrom(req);
  if (!orderNumber) {
    res
      .status(400)
      .type("html")
      .send(
        htmlPage(
          "Missing order",
          "Add ?order=&lt;order number&gt; to this link to send its status update.",
        ),
      );
    return;
  }

  try {
    const result = await notifyOrderStageChange(orderNumber);
    logger.info(result, "Order status-change link processed");
    const message =
      result.status === "sent"
        ? `A status update for order ${escapeHtml(result.orderNumber)} (now at ${escapeHtml(result.currentStage ?? "")}) is on its way. You can close this tab.`
        : result.status === "not_found"
          ? `No order found for "${escapeHtml(orderNumber)}". You can close this tab.`
          : `Nothing sent for order ${escapeHtml(result.orderNumber)} — ${escapeHtml(result.reason ?? "skipped")}. You can close this tab.`;
    res.status(200).type("html").send(htmlPage("Order update", message));
  } catch (err) {
    logger.error({ err, orderNumber }, "Order status-change link failed");
    res
      .status(500)
      .type("html")
      .send(
        htmlPage(
          "Something went wrong",
          "We couldn't send that update just now. Please try again in a moment.",
        ),
      );
  }
}
