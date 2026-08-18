import { Router } from "express";
import { GetStudioAnalyticsResponse } from "@workspace/api-zod";
import { requireStaff } from "../middlewares/auth.js";
import { accountRateLimiter } from "../middlewares/rate-limit.js";
import { getStudioAnalytics } from "../services/studio-analytics.service.js";

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

export default router;
