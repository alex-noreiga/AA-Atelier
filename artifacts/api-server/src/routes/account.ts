import { Router } from "express";
import {
  RequestMagicLinkBody,
  RequestMagicLinkResponse,
  GetAccountOverviewResponse,
  LogoutAccountResponse,
} from "@workspace/api-zod";
import { validate } from "../middlewares/validate.js";
import { requireCustomer, type SessionCustomer } from "../middlewares/auth.js";
import { clearSessionCookie } from "../lib/auth/cookies.js";
import {
  requestMagicLink,
  getAccountOverview,
} from "../services/account.service.js";

const router = Router();

// Ask for a sign-in link. Always 200 with a generic acknowledgement (identity is
// the email — there's no account to enumerate) so the response can't be used to
// probe which addresses have orders. The email is sent best-effort in the service.
router.post(
  "/account/login",
  validate({ body: RequestMagicLinkBody }),
  async (_req, res) => {
    const { email } = res.locals.body as { email: string };
    await requestMagicLink(email);
    res.json(
      RequestMagicLinkResponse.parse({
        message: "If we can reach you, a sign-in link is on its way.",
      }),
    );
  },
);

// The signed-in customer's orders + shop orders. `requireCustomer` resolves the
// session cookie to an email (or 401s), and the overview is looked up from it.
router.get("/account/overview", requireCustomer, async (_req, res) => {
  const { email } = res.locals.customer as SessionCustomer;
  const overview = await getAccountOverview(email);
  res.json(GetAccountOverviewResponse.parse(overview));
});

// Sign out — clear the session cookie. Idempotent (fine when already signed out).
router.post("/account/logout", async (_req, res) => {
  clearSessionCookie(res);
  res.json(LogoutAccountResponse.parse({ message: "Signed out." }));
});

export default router;
