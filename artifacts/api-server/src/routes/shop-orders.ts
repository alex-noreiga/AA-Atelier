import { Router } from "express";
import {
  GetShopOrderStatusParams,
  GetShopOrderStatusResponse,
  CreateShopOrderCancellationRequestParams,
  CreateShopOrderCancellationRequestBody,
  CreateShopOrderCancellationRequestResponse,
} from "@workspace/api-zod";
import { validate } from "../middlewares/validate.js";
import { getShopOrderStatus } from "../services/shop-orders.service.js";
import { submitShopOrderCancellationRequest } from "../services/cancellation.service.js";
import type { CreateCancellationInput } from "../services/cancellation.service.js";

const router = Router();

router.get(
  "/shop-orders/:orderNumber",
  validate({ params: GetShopOrderStatusParams }),
  async (_req, res) => {
    const { orderNumber } = res.locals.params as { orderNumber: string };
    const order = await getShopOrderStatus(orderNumber);
    res.json(GetShopOrderStatusResponse.parse(order));
  },
);

router.post(
  "/shop-orders/:orderNumber/cancellation-requests",
  validate({
    params: CreateShopOrderCancellationRequestParams,
    body: CreateShopOrderCancellationRequestBody,
  }),
  async (_req, res) => {
    const { orderNumber } = res.locals.params as { orderNumber: string };
    const body = res.locals.body as CreateCancellationInput;
    const result = await submitShopOrderCancellationRequest(orderNumber, body);
    res
      .status(201)
      .json(CreateShopOrderCancellationRequestResponse.parse(result));
  },
);

export default router;
