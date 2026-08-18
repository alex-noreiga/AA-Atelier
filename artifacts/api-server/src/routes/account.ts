import { Router } from "express";
import { GetAccountOverviewResponse } from "@workspace/api-zod";
import { requireCustomer, type SessionCustomer } from "../middlewares/auth.js";
import { accountRateLimiter } from "../middlewares/rate-limit.js";
import { getAccountOverview } from "../services/account.service.js";

const router = Router();

// Sign-in itself runs on Supabase Auth in the browser (email+password / Google /
// magic link); there is no server login/logout route anymore — the browser holds
// the session and logout is `supabase.auth.signOut()`. The only server route is
// the read below.

// The signed-in customer's orders + shop orders + upcoming appointments.
// `requireCustomer` verifies the Supabase access token (Bearer) and resolves it
// to the customer's email (or 401s); the overview is looked up from that email.
// The rate limiter stays as a cheap brake on this authorization surface.
router.get(
  "/account/overview",
  accountRateLimiter,
  requireCustomer,
  async (_req, res) => {
    const { email } = res.locals.customer as SessionCustomer;
    const overview = await getAccountOverview(email);
    res.json(GetAccountOverviewResponse.parse(overview));
  },
);

export default router;
