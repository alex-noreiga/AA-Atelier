import { Router } from "express";
import healthRouter from "./health.js";
import ordersRouter from "./orders.js";
import contactRouter from "./contact.js";
import productsRouter from "./products.js";
import portfolioRouter from "./portfolio.js";
import notifyRouter from "./notify.js";
import checkoutRouter from "./checkout.js";
import shopOrdersRouter from "./shop-orders.js";
import appointmentsRouter from "./appointments.js";

const router = Router();

router.use(healthRouter);
router.use(ordersRouter);
router.use(contactRouter);
router.use(productsRouter);
router.use(portfolioRouter);
router.use(notifyRouter);
router.use(checkoutRouter);
router.use(shopOrdersRouter);
router.use(appointmentsRouter);

export default router;
