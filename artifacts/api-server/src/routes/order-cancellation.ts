// On-demand order cancellation + refund, triggered by the atelier from Notion.
//
// Like the milestone cron/button, the invoice generator, and the Stripe webhook,
// this is deliberately NOT part of the OpenAPI contract or the generated client —
// an internal atelier action, mounted directly on the app (see app.ts). It reuses
// CRON_SECRET as its access token, the same low-stakes reuse the other buttons make.
//
// Two triggers for the same job (`processCancellation`), both taking the order
// number as `?order=`:
//   1. `GET /api/orders/process-cancellation`      — Bearer CRON_SECRET, JSON.
//   2. `GET /api/orders/process-cancellation/run`  — a Notion link the atelier
//      clicks (a formula-built URL carrying the row's Order Number). A link can't
//      send a Bearer header, so this authenticates with a `?secret=` query token
//      and returns a small HTML confirmation page. The request logger strips the
//      query string, so neither token nor order number is logged.

import type { Request, Response } from "express";
import {
  processCancellation,
  type CancellationResult,
} from "../services/order-cancellation.service.js";
import { NotFoundError, BadRequestError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

function orderParam(req: Request): string {
  const order = req.query.order;
  return typeof order === "string" ? order.trim() : "";
}

export async function processCancellationHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const orderNumber = orderParam(req);
  if (!orderNumber) {
    res.status(400).json({ error: "Missing ?order= query parameter" });
    return;
  }

  try {
    const result = await processCancellation(orderNumber);
    logger.info(result, "Order cancellation processed");
    res.json(result);
  } catch (err) {
    if (err instanceof NotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err instanceof BadRequestError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
}

/** Escape text interpolated into the confirmation HTML. The order number reaches
 * this page from the `?order=` query param, so it must be neutralized at the sink
 * (the query param is attacker-controlled — reflected XSS otherwise). */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** A minimal self-contained HTML confirmation page for the Notion link's tab.
 * Both fields are escaped, so any dynamic value (e.g. the order number) is inert. */
function htmlPage(title: string, message: string): string {
  const t = escapeHtml(title);
  const m = escapeHtml(message);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${t}</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:ui-serif,Georgia,serif;background:#faf8f5;color:#2b2b2b}main{max-width:26rem;padding:2.5rem;text-align:center}h1{font-size:1.5rem;font-weight:500;margin:0 0 .75rem}p{color:#6b6b6b;line-height:1.5;margin:0}</style></head><body><main><h1>${t}</h1><p>${m}</p></main></body></html>`;
}

/** Compose the atelier-facing summary line from a cancellation result. */
function summaryMessage(result: CancellationResult): string {
  const parts: string[] = [];
  if (result.refundsIssued > 0) {
    parts.push(
      `refunded ${result.refundsIssued} payment${result.refundsIssued === 1 ? "" : "s"} totalling $${result.totalRefunded.toFixed(2)}`,
    );
  } else {
    parts.push("no new refunds were needed");
  }
  if (result.alreadyCancelled) {
    parts.push("the order was already cancelled");
  } else if (result.cancelledNow) {
    parts.push("the order is now marked cancelled");
  }
  let message = `Order ${result.orderNumber}: ${parts.join(", ")}.`;
  if (result.skipped.length > 0) {
    message += ` Note — ${result.skipped.join("; ")}.`;
  }
  message += " You can close this tab.";
  return message;
}

export async function processCancellationButtonHandler(
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
          "This cancellation link is missing a valid access token.",
        ),
      );
    return;
  }

  const orderNumber = orderParam(req);
  if (!orderNumber) {
    res
      .status(400)
      .type("html")
      .send(
        htmlPage(
          "Missing order",
          "This link didn't include an order number to cancel.",
        ),
      );
    return;
  }

  try {
    const result = await processCancellation(orderNumber);
    logger.info(result, "Order cancellation processed (button)");

    // A partial refund failure leaves the order uncancelled so it can be retried;
    // tell the atelier plainly rather than claiming success.
    if (result.hadError) {
      res
        .status(200)
        .type("html")
        .send(
          htmlPage(
            "Refund needs attention",
            `Order ${result.orderNumber} could not be fully refunded, so it was left uncancelled. ${result.skipped.join("; ")}. Fix the issue in Stripe and click the link again.`,
          ),
        );
      return;
    }

    res
      .status(200)
      .type("html")
      .send(htmlPage("✅ Cancellation processed", summaryMessage(result)));
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof BadRequestError) {
      res
        .status(400)
        .type("html")
        .send(htmlPage("Couldn't cancel", err.message));
      return;
    }
    logger.error({ err }, "Order cancellation (button) failed");
    res
      .status(500)
      .type("html")
      .send(
        htmlPage(
          "Something went wrong",
          "We couldn't process this cancellation just now. Please try again in a moment.",
        ),
      );
  }
}
