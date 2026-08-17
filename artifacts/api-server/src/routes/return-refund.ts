// On-demand return / exchange refund, triggered by the atelier from Notion.
//
// Like the cancellation refund it mirrors, this is deliberately NOT part of the
// OpenAPI contract or the generated client — an internal atelier action mounted
// directly on the app (see app.ts), gated by CRON_SECRET.
//
// Two triggers for the same job (`processReturnRefund`), both taking the shop
// order number as `?order=` and an optional `?amount=` in dollars:
//   1. `GET /api/shop-orders/process-return`      — Bearer CRON_SECRET, JSON.
//   2. `GET /api/shop-orders/process-return/run`  — a Notion link the atelier
//      clicks (a formula-built URL carrying the row's Order Number). A link
//      can't send a Bearer header, so this authenticates with a `?secret=`
//      query token and returns an HTML confirmation page. The request logger
//      strips the query string, so neither token nor amount is logged.
//
// `?amount=` is a TARGET TOTAL, not an increment — see the service header for
// why that's what makes a re-pressed link safe.

import type { Request, Response } from "express";
import {
  processReturnRefund,
  parseRefundTarget,
  type ReturnRefundResult,
} from "../services/return-refund.service.js";
import {
  htmlPage,
  orderParam,
  hasCronBearer,
  hasCronQuerySecret,
} from "../lib/cron-route.js";
import { NotFoundError, BadRequestError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

/** The raw `?amount=` query param, or undefined when absent. */
function amountParam(req: Request): string | undefined {
  const amount = req.query.amount;
  return typeof amount === "string" ? amount : undefined;
}

export async function processReturnRefundHandler(
  req: Request,
  res: Response,
): Promise<void> {
  if (!hasCronBearer(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const orderNumber = orderParam(req);
  if (!orderNumber) {
    res.status(400).json({ error: "Missing ?order= query parameter" });
    return;
  }

  try {
    const target = parseRefundTarget(amountParam(req));
    const result = await processReturnRefund(orderNumber, target);
    logger.info(result, "Return refund processed");
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

/** Compose the atelier-facing summary line from a return-refund result. */
function summaryMessage(result: ReturnRefundResult): string {
  const parts: string[] = [];

  if (result.status === "refunded") {
    parts.push(`refunded $${result.refunded.toFixed(2)}`);
    if (result.totalRefunded > result.refunded) {
      parts.push(
        `$${result.totalRefunded.toFixed(2)} refunded on this order in total`,
      );
    }
    parts.push(
      result.fullyRefunded
        ? "the order is now fully refunded"
        : `$${(result.captured - result.totalRefunded).toFixed(2)} of the original payment remains`,
    );
  } else {
    parts.push("no refund was issued");
  }

  let message = `Order ${result.orderNumber}: ${parts.join(", ")}.`;
  if (result.notes.length > 0) {
    message += ` Note — ${result.notes.join("; ")}.`;
  }
  message += " You can close this tab.";
  return message;
}

export async function processReturnRefundButtonHandler(
  req: Request,
  res: Response,
): Promise<void> {
  if (!hasCronQuerySecret(req)) {
    res
      .status(401)
      .type("html")
      .send(
        htmlPage(
          "Not authorized",
          "This refund link is missing a valid access token.",
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
          "This link didn't include a shop order number to refund.",
        ),
      );
    return;
  }

  try {
    const target = parseRefundTarget(amountParam(req));
    const result = await processReturnRefund(orderNumber, target);
    logger.info(result, "Return refund processed (button)");

    // A Stripe failure refunded nothing; say so plainly rather than claiming
    // success. Re-pressing is safe — the target is recomputed from Stripe.
    if (result.status === "error") {
      res
        .status(200)
        .type("html")
        .send(
          htmlPage(
            "Refund needs attention",
            `Order ${result.orderNumber} could not be refunded. ${result.notes.join("; ")}. Fix the issue in Stripe and click the link again.`,
          ),
        );
      return;
    }

    res
      .status(200)
      .type("html")
      .send(htmlPage("✅ Refund processed", summaryMessage(result)));
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof BadRequestError) {
      res
        .status(400)
        .type("html")
        .send(htmlPage("Couldn't refund", err.message));
      return;
    }
    logger.error({ err }, "Return refund (button) failed");
    res
      .status(500)
      .type("html")
      .send(
        htmlPage(
          "Something went wrong",
          "We couldn't process this refund just now. Please try again in a moment.",
        ),
      );
  }
}
