import { Router } from "express";
import {
  RequestCartReminderBody,
  RequestCartReminderResponse,
} from "@workspace/api-zod";
import { validate } from "../middlewares/validate.js";
import { submissionRateLimiter } from "../middlewares/rate-limit.js";
import { spamFilter } from "../middlewares/spam-filter.js";
import {
  saveCartReminder,
  type CartReminderInput,
} from "../services/cart-recovery.service.js";

const router = Router();

// Public + anonymous like the contact/notify/newsletter captures, so it carries
// the same invisible anti-spam stack: per-IP rate limit, then the honeypot +
// fill-time check that answers a flagged submit with the success shape while
// writing nothing.
router.post(
  "/cart-reminders",
  submissionRateLimiter,
  validate({ body: RequestCartReminderBody }),
  spamFilter({ status: 201, body: { success: true } }),
  async (_req, res) => {
    const body = res.locals.body as CartReminderInput;
    const result = await saveCartReminder(body);
    res.status(201).json(RequestCartReminderResponse.parse(result));
  },
);

export default router;
