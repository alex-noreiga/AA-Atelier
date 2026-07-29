import { Router } from "express";
import {
  GetShopOrderStatusParams,
  GetShopOrderStatusResponse,
  CreateReturnRequestParams,
  CreateReturnRequestBody,
  CreateReturnRequestResponse,
} from "@workspace/api-zod";
import { validate } from "../middlewares/validate.js";
import { getShopOrderStatus } from "../services/shop-orders.service.js";
import { submitReturnRequest } from "../services/return-request.service.js";
import type { CreateReturnInput } from "../lib/notion/return-request.blocks.js";

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
  "/shop-orders/:orderNumber/return-requests",
  validate({
    params: CreateReturnRequestParams,
    body: CreateReturnRequestBody,
  }),
  async (_req, res) => {
    const { orderNumber } = res.locals.params as { orderNumber: string };
    const body = res.locals.body as CreateReturnInput;
    const result = await submitReturnRequest(orderNumber, body);
    res.status(201).json(CreateReturnRequestResponse.parse(result));
  },
);

export default router;
