import { Router } from "express";
import {
  GetOrderStatusParams,
  GetOrderStatusResponse,
  CreateOrderBody,
  CreateOrderResponse,
  CreateOrderDepositParams,
  CreateOrderDepositResponse,
  CreateMeasurementChangeRequestParams,
  CreateMeasurementChangeRequestBody,
  CreateMeasurementChangeRequestResponse,
} from "@workspace/api-zod";
import { validate } from "../middlewares/validate.js";
import { getOrderStatus, submitOrder } from "../services/orders.service.js";
import { createDepositCheckout } from "../services/deposit.service.js";
import { submitMeasurementChangeRequest } from "../services/measurement-change.service.js";
import type { CreateOrderInput } from "../lib/notion/schema.js";
import type { CreateMeasurementChangeInput } from "../lib/notion/measurement-change.blocks.js";

const router = Router();

router.get(
  "/orders/:orderNumber",
  validate({ params: GetOrderStatusParams }),
  async (_req, res) => {
    const { orderNumber } = res.locals.params as { orderNumber: string };
    const order = await getOrderStatus(orderNumber);
    res.json(GetOrderStatusResponse.parse(order));
  },
);

router.post(
  "/orders",
  validate({ body: CreateOrderBody }),
  async (_req, res) => {
    const body = res.locals.body as CreateOrderInput;
    const result = await submitOrder(body);
    res.status(201).json(CreateOrderResponse.parse(result));
  },
);

router.post(
  "/orders/:orderNumber/deposit",
  validate({ params: CreateOrderDepositParams }),
  async (_req, res) => {
    const { orderNumber } = res.locals.params as { orderNumber: string };
    const result = await createDepositCheckout(orderNumber);
    res.status(201).json(CreateOrderDepositResponse.parse(result));
  },
);

router.post(
  "/orders/:orderNumber/measurement-change-requests",
  validate({
    params: CreateMeasurementChangeRequestParams,
    body: CreateMeasurementChangeRequestBody,
  }),
  async (_req, res) => {
    const { orderNumber } = res.locals.params as { orderNumber: string };
    const body = res.locals.body as CreateMeasurementChangeInput;
    const result = await submitMeasurementChangeRequest(orderNumber, body);
    res.status(201).json(CreateMeasurementChangeRequestResponse.parse(result));
  },
);

export default router;
