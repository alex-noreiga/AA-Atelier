import { Router } from "express";
import {
  GetOrderStatusParams,
  GetOrderStatusResponse,
  CreateOrderBody,
  CreateOrderResponse,
} from "@workspace/api-zod";
import { validate } from "../middlewares/validate.js";
import { getOrderStatus, submitOrder } from "../services/orders.service.js";
import type { CreateOrderInput } from "../lib/notion/schema.js";

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

export default router;
