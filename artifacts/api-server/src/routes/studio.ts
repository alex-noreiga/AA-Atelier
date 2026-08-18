import { Router } from "express";
import {
  GetStudioAnalyticsResponse,
  RunStudioToolBody,
  RunStudioToolParams,
  RunStudioToolResponse,
} from "@workspace/api-zod";
import { requireStaff } from "../middlewares/auth.js";
import { accountRateLimiter } from "../middlewares/rate-limit.js";
import { validate } from "../middlewares/validate.js";
import { getStudioAnalytics } from "../services/studio-analytics.service.js";
import {
  runStudioTool,
  type StudioToolArgs,
  type StudioToolName,
} from "../services/studio-tools.service.js";

const router = Router();

// The internal studio dashboard's figures. `requireStaff` verifies the same
// Supabase access token the customer portal uses and additionally requires the
// signed-in email to be on the studio allowlist — 401 when not signed in, 403
// when signed in as a customer. The account limiter is reused as a cheap brake
// on the authorization surface, exactly as on `/account/overview`.
router.get(
  "/studio/analytics",
  accountRateLimiter,
  requireStaff,
  async (_req, res) => {
    const analytics = await getStudioAnalytics();
    res.json(GetStudioAnalyticsResponse.parse(analytics));
  },
);

// The internal tools — the atelier actions that used to be links carrying
// `CRON_SECRET` in their query string (milestone reconciliation, invoice
// itemization, a status-change email, the two refunds). Same `requireStaff`
// gate as the figures above: the work is unchanged, only who may trigger it.
//
// Unlike those links this is contract-first, because it's an ordinary SPA JSON
// call from the dashboard rather than a browser tab the atelier opens by hand —
// so the tool name and its arguments are validated by the generated schemas
// before the service sees them, and an unknown tool is a 400 rather than a
// route that quietly doesn't exist.
router.post(
  "/studio/tools/:tool",
  accountRateLimiter,
  requireStaff,
  validate({ params: RunStudioToolParams, body: RunStudioToolBody }),
  async (_req, res) => {
    const { tool } = res.locals.params as { tool: StudioToolName };
    const result = await runStudioTool(tool, res.locals.body as StudioToolArgs);
    res.json(RunStudioToolResponse.parse(result));
  },
);

export default router;
