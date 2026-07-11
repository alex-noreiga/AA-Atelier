import { Router } from "express";
import {
  GetOrderStatusResponse,
  CreateOrderBody,
  CreateOrderResponse,
  type OrderNotFound,
} from "@workspace/api-zod";
import { findOrderByNumber, createOrder } from "../lib/notion.js";
import { logger } from "../lib/logger.js";

const router = Router();

router.get("/orders/:orderNumber", async (req, res) => {
  const { orderNumber } = req.params;

  try {
    const order = await findOrderByNumber(orderNumber);

    if (!order) {
      const data: OrderNotFound = {
        message: "We couldn't find an order with that number.",
      };
      res.status(404).json(data);
      return;
    }

    const stages = order.stages.includes(order.currentStage)
      ? order.stages
      : [...order.stages, order.currentStage];

    const data = GetOrderStatusResponse.parse({
      orderNumber: order.orderNumber,
      orderName: order.orderName,
      currentStage: order.currentStage,
      stages,
    });
    res.json(data);
  } catch (error) {
    logger.error({ err: error }, "Failed to look up order status");
    res.status(500).json({ message: "Something went wrong. Please try again later." });
  }
});

router.post("/orders", async (req, res) => {
  const parsed = CreateOrderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const orderNumber = await createOrder(parsed.data);
    const data = CreateOrderResponse.parse({ orderNumber });
    res.status(201).json(data);
  } catch (error) {
    logger.error({ err: error }, "Failed to create order");
    res.status(500).json({ error: "Something went wrong. Please try again later." });
  }
});

export default router;
