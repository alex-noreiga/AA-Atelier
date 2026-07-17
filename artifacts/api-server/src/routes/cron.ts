// Scheduler-facing reconciliation endpoint. Vercel Cron hits this on a schedule
// (see `vercel.json`): because Notion can't push the app when the atelier sets
// an order's due date, we poll for orders that need milestones and generate them
// (schedule.service.ts). It is deliberately NOT part of the OpenAPI contract or
// the generated client — a scheduler -> server endpoint, like the Stripe webhook
// — so it's registered directly on the app rather than in the /api router.
//
// Auth: Vercel sends `Authorization: Bearer $CRON_SECRET` on cron invocations
// when CRON_SECRET is configured. We require it, so the endpoint can't be
// triggered by an anonymous request.
//
// There are two triggers for the SAME reconciliation (`generatePendingMilestones`):
//   1. `GET /api/cron/generate-milestones` — Vercel Cron (Bearer header, JSON).
//   2. `GET /api/cron/generate-milestones/run` — a Notion "Open link" button the
//      atelier presses on demand. A native Notion button can only open a URL (no
//      custom headers), so this one authenticates with a `?secret=` query token
//      (same CRON_SECRET) and returns a small HTML confirmation page for the tab
//      it opens. The request logger strips the query string, so the token isn't
//      logged; it is still visible in the button's config + browser history.

import type { Request, Response } from "express";
import { generatePendingMilestones } from "../services/schedule.service.js";
import { logger } from "../lib/logger.js";

export async function generateMilestonesHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const result = await generatePendingMilestones();
  logger.info(result, "Milestone reconciliation complete");
  res.json(result);
}

/** A minimal self-contained HTML confirmation page for the Notion button tab. */
function htmlPage(title: string, message: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:ui-serif,Georgia,serif;background:#faf8f5;color:#2b2b2b}main{max-width:26rem;padding:2.5rem;text-align:center}h1{font-size:1.5rem;font-weight:500;margin:0 0 .75rem}p{color:#6b6b6b;line-height:1.5;margin:0}</style></head><body><main><h1>${title}</h1><p>${message}</p></main></body></html>`;
}

export async function generateMilestonesButtonHandler(
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
          "This milestone-generation link is missing a valid access token.",
        ),
      );
    return;
  }

  try {
    const result = await generatePendingMilestones();
    logger.info(result, "Milestone reconciliation complete (button)");
    const { ordersProcessed, milestonesCreated } = result;
    const summary =
      milestonesCreated === 0
        ? "Everything was already up to date — no new milestones were needed."
        : `Generated ${milestonesCreated} milestone${milestonesCreated === 1 ? "" : "s"} across ${ordersProcessed} order${ordersProcessed === 1 ? "" : "s"}.`;
    res
      .status(200)
      .type("html")
      .send(
        htmlPage(
          "✅ Milestones generated",
          `${summary} You can close this tab.`,
        ),
      );
  } catch (err) {
    // The service swallows per-order failures, so this is belt-and-suspenders.
    // Render HTML here rather than rethrow — the shared error handler emits JSON.
    logger.error({ err }, "Milestone reconciliation (button) failed");
    res
      .status(500)
      .type("html")
      .send(
        htmlPage(
          "Something went wrong",
          "We couldn't generate the milestones just now. Please try again in a moment.",
        ),
      );
  }
}
