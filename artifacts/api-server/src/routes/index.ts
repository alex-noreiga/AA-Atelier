import { Router } from "express";
import healthRouter from "./health.js";
import ordersRouter from "./orders.js";

const router = Router();

router.use(healthRouter);
router.use(ordersRouter);

export default router;
