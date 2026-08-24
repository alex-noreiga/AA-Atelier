import { Router } from "express";
import { JoinWaitlistBody, JoinWaitlistResponse } from "@workspace/api-zod";
import { validate } from "../middlewares/validate.js";
import { submissionRateLimiter } from "../middlewares/rate-limit.js";
import { spamFilter } from "../middlewares/spam-filter.js";
import { joinWaitlist } from "../services/waitlist.service.js";
import type { CreateWaitlistInput } from "../lib/notion/waitlist.blocks.js";

const router = Router();

// Anonymous and public, like /contact, /notify and /newsletter — so it carries
// the same three anti-spam signals (honeypot, fill-time, per-IP limit). A
// flagged submit gets the success response it would have got, and writes
// nothing.
router.post(
  "/waitlist",
  submissionRateLimiter,
  validate({ body: JoinWaitlistBody }),
  spamFilter({ status: 201, body: { success: true } }),
  async (_req, res) => {
    const body = res.locals.body as CreateWaitlistInput;
    const result = await joinWaitlist(body);
    res.status(201).json(JoinWaitlistResponse.parse(result));
  },
);

export default router;
