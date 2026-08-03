import { Router } from "express";
import {
  CreateBackInStockRequestBody,
  CreateBackInStockRequestResponse,
} from "@workspace/api-zod";
import { validate } from "../middlewares/validate.js";
import { submissionRateLimiter } from "../middlewares/rate-limit.js";
import { spamFilter } from "../middlewares/spam-filter.js";
import { submitBackInStockRequest } from "../services/notify.service.js";
import type { CreateNotifyInput } from "../lib/notion/notify.blocks.js";

const router = Router();

router.post(
  "/notify",
  submissionRateLimiter,
  validate({ body: CreateBackInStockRequestBody }),
  spamFilter({ status: 201, body: { success: true } }),
  async (_req, res) => {
    const body = res.locals.body as CreateNotifyInput;
    const result = await submitBackInStockRequest(body);
    res.status(201).json(CreateBackInStockRequestResponse.parse(result));
  },
);

export default router;
