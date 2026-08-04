// Shared helpers for the internal atelier "button"/cron routes — the ones
// deliberately outside the OpenAPI contract, mounted directly on the app and
// gated by `CRON_SECRET` (milestone reconciliation, invoice-line generation,
// order cancellation, order status-change). They each authenticate the same two
// ways and render the same minimal HTML confirmation page, so that shape lives
// here once instead of being copy-pasted per route.

import type { Request } from "express";

/** Escape dynamic values before interpolating them into a confirmation page.
 * The order number reaches these pages from the `?order=` query param, so it must
 * be neutralized at the sink (the query param is attacker-controlled — reflected
 * XSS otherwise). */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** A minimal self-contained HTML confirmation page for a Notion link/button tab.
 * Both fields are escaped, so any dynamic value (e.g. an order number) is inert —
 * pass plain text, not pre-escaped markup. */
export function htmlPage(title: string, message: string): string {
  const t = escapeHtml(title);
  const m = escapeHtml(message);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${t}</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:ui-serif,Georgia,serif;background:#faf8f5;color:#2b2b2b}main{max-width:26rem;padding:2.5rem;text-align:center}h1{font-size:1.5rem;font-weight:500;margin:0 0 .75rem}p{color:#6b6b6b;line-height:1.5;margin:0}</style></head><body><main><h1>${t}</h1><p>${m}</p></main></body></html>`;
}

/** Authorized when `Authorization: Bearer <CRON_SECRET>` matches — the header
 * form used by Vercel Cron and the Notion automation (keeps the token out of the
 * URL and logs). False when `CRON_SECRET` is unset. */
export function hasCronBearer(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  return !!secret && req.headers.authorization === `Bearer ${secret}`;
}

/** Authorized when `?secret=<CRON_SECRET>` matches — the fallback for a browser
 * `/run` link, which can't send a custom header. False when `CRON_SECRET` is
 * unset. */
export function hasCronQuerySecret(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  return !!secret && req.query.secret === secret;
}

/** The trimmed `?order=` query param, or "" when absent. */
export function orderParam(req: Request): string {
  const order = req.query.order;
  return typeof order === "string" ? order.trim() : "";
}
