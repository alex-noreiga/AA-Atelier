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
