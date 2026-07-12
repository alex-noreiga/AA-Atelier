import { Router } from "express";
import healthRouter from "./health.js";
import ordersRouter from "./orders.js";
import contactRouter from "./contact.js";

const router = Router();

router.use(healthRouter);
router.use(ordersRouter);
router.use(contactRouter);

export default router;
