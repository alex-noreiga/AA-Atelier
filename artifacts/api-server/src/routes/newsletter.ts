import { Router } from "express";
import {
  SubscribeNewsletterBody,
  SubscribeNewsletterResponse,
} from "@workspace/api-zod";
import { validate } from "../middlewares/validate.js";
import { subscribeToNewsletter } from "../services/newsletter.service.js";
import type { CreateNewsletterInput } from "../lib/notion/newsletter.blocks.js";

const router = Router();

router.post(
  "/newsletter",
  validate({ body: SubscribeNewsletterBody }),
  async (_req, res) => {
    const body = res.locals.body as CreateNewsletterInput;
    const result = await subscribeToNewsletter(body);
    res.status(201).json(SubscribeNewsletterResponse.parse(result));
  },
);

export default router;
