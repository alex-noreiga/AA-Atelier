import { Router } from "express";
import healthRouter from "./health.js";
import ordersRouter from "./orders.js";
import contactRouter from "./contact.js";
import productsRouter from "./products.js";

const router = Router();

router.use(healthRouter);
router.use(ordersRouter);
router.use(contactRouter);
router.use(productsRouter);

export default router;
