import { Router } from "express";
import healthRouter from "./health.js";
import ordersRouter from "./orders.js";
import contactRouter from "./contact.js";
import productsRouter from "./products.js";
import fabricsRouter from "./fabrics.js";
import notifyRouter from "./notify.js";
import newsletterRouter from "./newsletter.js";
import checkoutRouter from "./checkout.js";
import shopOrdersRouter from "./shop-orders.js";
import appointmentsRouter from "./appointments.js";
import accountRouter from "./account.js";

const router = Router();

router.use(healthRouter);
router.use(ordersRouter);
router.use(contactRouter);
router.use(productsRouter);
router.use(fabricsRouter);
router.use(notifyRouter);
router.use(newsletterRouter);
router.use(checkoutRouter);
router.use(shopOrdersRouter);
router.use(appointmentsRouter);
router.use(accountRouter);

export default router;
