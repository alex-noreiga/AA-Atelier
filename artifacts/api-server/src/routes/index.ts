import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import ordersRouter from "./orders.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(ordersRouter);

export default router;
