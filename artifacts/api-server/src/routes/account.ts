import { Router } from "express";
import {
  GetAccountOverviewResponse,
  ExportAccountDataResponse,
  RequestAccountDeletionBody,
  RequestAccountDeletionResponse,
} from "@workspace/api-zod";
import { requireCustomer, type SessionCustomer } from "../middlewares/auth.js";
import { accountRateLimiter } from "../middlewares/rate-limit.js";
import { validate } from "../middlewares/validate.js";
import { getAccountOverview } from "../services/account.service.js";
import {
  exportAccountData,
  submitAccountDeletionRequest,
  type CreateDeletionRequestInput,
} from "../services/account-data.service.js";

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

// The customer's data rights, both keyed on the same session email the overview
// is. The export is a read they may make of themselves; the deletion request
// files an item of work for a person (see `account-data.service.ts` for why the
// app erases nothing itself). Both carry the account rate limiter, the export
// especially — it is the heaviest read in the portal, fanning out across every
// store the app writes personal data into.
router.get(
  "/account/export",
  accountRateLimiter,
  requireCustomer,
  async (_req, res) => {
    const { email, userId } = res.locals.customer as SessionCustomer;
    const data = await exportAccountData(email, userId);
    // The one response in the app that is a person's whole record in one body.
    // Vercel's CDN already declines to cache a request carrying an
    // `Authorization` header, but a browser or a corporate proxy is not bound by
    // that, so say it outright rather than relying on the platform.
    res.setHeader("Cache-Control", "no-store");
    res.json(ExportAccountDataResponse.parse(data));
  },
);

router.post(
  "/account/deletion-requests",
  accountRateLimiter,
  requireCustomer,
  validate({ body: RequestAccountDeletionBody }),
  async (_req, res) => {
    const { email, userId } = res.locals.customer as SessionCustomer;
    const body = res.locals.body as CreateDeletionRequestInput;
    const result = await submitAccountDeletionRequest(email, body, userId);
    res.status(201).json(RequestAccountDeletionResponse.parse(result));
  },
);

export default router;
