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
import { NotFoundError, BadRequestError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

function orderParam(req: Request): string {
  const order = req.query.order;
  return typeof order === "string" ? order.trim() : "";
}

export async function generateLineItemsHandler(
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

/** Escape text interpolated into the confirmation HTML. The order number reaches
 * these pages from the `?order=` query param, so it must be neutralized at the
 * sink (a match against a real order can't contain markup, but the query param
 * is still attacker-controlled — reflected XSS otherwise). */
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

export async function generateLineItemsButtonHandler(
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
