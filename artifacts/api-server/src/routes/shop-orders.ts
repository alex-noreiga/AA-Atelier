import { Router } from "express";
import {
  GetShopOrderStatusParams,
  GetShopOrderStatusResponse,
} from "@workspace/api-zod";
import { validate } from "../middlewares/validate.js";
import { getShopOrderStatus } from "../services/shop-orders.service.js";

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

export default router;
