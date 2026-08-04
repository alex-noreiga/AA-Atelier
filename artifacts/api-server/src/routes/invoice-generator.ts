// On-demand invoice line-item generation, triggered by the atelier from Notion.
//
// Like the milestone cron/button and the Stripe webhook, this is deliberately
// NOT part of the OpenAPI contract or the generated client — an internal
// atelier action, mounted directly on the app (see app.ts). It reuses
// CRON_SECRET as its access token, the same low-stakes reuse the milestone
// button makes.
//
// Two triggers for the same job (`generateInvoiceLineItems`), both taking the
// order number as `?order=`:
//   1. `GET /api/invoices/generate-line-items`      — Bearer CRON_SECRET, JSON.
//   2. `GET /api/invoices/generate-line-items/run`  — a Notion link the atelier
//      clicks (a formula-built URL carrying the row's Order Number). A link can't
//      send a Bearer header, so this authenticates with a `?secret=` query token
//      and returns a small HTML confirmation page. The request logger strips the
//      query string, so neither token nor order number is logged.

import type { Request, Response } from "express";
import { generateInvoiceLineItems } from "../services/invoice-generator.service.js";
import {
  htmlPage,
  orderParam,
  hasCronBearer,
  hasCronQuerySecret,
} from "../lib/cron-route.js";
import { NotFoundError, BadRequestError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

export async function generateLineItemsHandler(
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
    const result = await generateInvoiceLineItems(orderNumber);
    logger.info(result, "Invoice line-item generation complete");
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

export async function generateLineItemsButtonHandler(
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
          "This invoice-generation link is missing a valid access token.",
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
          "This link didn't include an order number to itemize.",
        ),
      );
    return;
  }

  try {
    const result = await generateInvoiceLineItems(orderNumber);
    logger.info(result, "Invoice line-item generation complete (button)");

    if (result.alreadyPresent) {
      res
        .status(200)
        .type("html")
        .send(
          htmlPage(
            "Nothing to generate",
            `Invoice ${result.orderNumber} already has line items, so nothing was added. To rebuild it, delete the existing lines and try again. You can close this tab.`,
          ),
        );
      return;
    }

    const parts: string[] = [];
    parts.push(
      `${result.materialLinesCreated} material line${result.materialLinesCreated === 1 ? "" : "s"}`,
    );
    if (result.laborLineCreated) parts.push("a labor line");
    if (result.adjustmentLineCreated) parts.push("a design & finishing line");
    if (result.rushSurcharge > 0)
      parts.push(`a rush surcharge of $${result.rushSurcharge.toFixed(2)}`);
    const lines =
      parts.length === 1
        ? parts[0]
        : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
    res
      .status(200)
      .type("html")
      .send(
        htmlPage(
          "✅ Invoice itemized",
          `Added ${lines} to invoice ${result.orderNumber}, totalling $${result.invoiceTotal.toFixed(2)}. You can close this tab.`,
        ),
      );
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof BadRequestError) {
      res
        .status(400)
        .type("html")
        .send(htmlPage("Couldn't itemize", err.message));
      return;
    }
    logger.error({ err }, "Invoice line-item generation (button) failed");
    res
      .status(500)
      .type("html")
      .send(
        htmlPage(
          "Something went wrong",
          "We couldn't generate the invoice lines just now. Please try again in a moment.",
        ),
      );
  }
}
