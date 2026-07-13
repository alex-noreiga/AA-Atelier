import { Router } from "express";
import {
  CreateCheckoutSessionBody,
  CreateCheckoutSessionResponse,
  GetCheckoutSessionParams,
  GetCheckoutSessionResponse,
  type CreateCheckoutSessionRequest,
} from "@workspace/api-zod";
import { validate } from "../middlewares/validate.js";
import {
  createCheckoutSession,
  getCheckoutSession,
} from "../services/checkout.service.js";

const router = Router();

router.post(
  "/checkout",
  validate({ body: CreateCheckoutSessionBody }),
  async (_req, res) => {
    const body = res.locals.body as CreateCheckoutSessionRequest;
    const result = await createCheckoutSession(body.items);
    res.status(201).json(CreateCheckoutSessionResponse.parse(result));
  },
);

router.get(
  "/checkout/session/:sessionId",
  validate({ params: GetCheckoutSessionParams }),
  async (_req, res) => {
    const { sessionId } = res.locals.params as { sessionId: string };
    const result = await getCheckoutSession(sessionId);
    res.json(GetCheckoutSessionResponse.parse(result));
  },
);

export default router;
