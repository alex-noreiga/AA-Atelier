import { Router } from "express";
import {
  GetOrderStatusParams,
  GetOrderStatusResponse,
  CreateOrderBody,
  CreateOrderResponse,
  CreateOrderPaymentParams,
  CreateOrderPaymentResponse,
  CreateMeasurementChangeRequestParams,
  CreateMeasurementChangeRequestBody,
  CreateMeasurementChangeRequestResponse,
  UpdateOrderMeasurementsParams,
  UpdateOrderMeasurementsBody,
  UpdateOrderMeasurementsResponse,
  CreateOrderReviewParams,
  CreateOrderReviewBody,
  CreateOrderReviewResponse,
  CreateOrderCancellationRequestParams,
  CreateOrderCancellationRequestBody,
  CreateOrderCancellationRequestResponse,
} from "@workspace/api-zod";
import { validate } from "../middlewares/validate.js";
import { getOrderStatus, submitOrder } from "../services/orders.service.js";
import { createPaymentCheckout } from "../services/invoice.service.js";
import { submitMeasurementChangeRequest } from "../services/measurement-change.service.js";
import { updateMeasurements } from "../services/measurement-update.service.js";
import { submitOrderReview } from "../services/review.service.js";
import { submitOrderCancellationRequest } from "../services/cancellation.service.js";
import type { CreateOrderInput } from "../lib/notion/orders.schema.js";
import type { PaymentStage } from "../lib/notion/invoice.schema.js";
import type { CreateMeasurementChangeInput } from "../lib/notion/measurement-change.blocks.js";
import type { UpdateMeasurementsInput } from "../services/measurement-update.service.js";
import type { CreateReviewInput } from "../lib/notion/reviews.blocks.js";
import type { CreateCancellationInput } from "../services/cancellation.service.js";

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
  "/orders/:orderNumber/payments/:stage",
  validate({ params: CreateOrderPaymentParams }),
  async (_req, res) => {
    const { orderNumber, stage } = res.locals.params as {
      orderNumber: string;
      stage: PaymentStage;
    };
    const result = await createPaymentCheckout(orderNumber, stage);
    res.status(201).json(CreateOrderPaymentResponse.parse(result));
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

// In-place measurement editing — the same order-scoped gates as the change
// request above, but this one writes the values onto the order rather than
// filing them for a human to apply. A PUT because it replaces the whole stored
// set: sending it twice leaves the order in the same state.
router.put(
  "/orders/:orderNumber/measurements",
  validate({
    params: UpdateOrderMeasurementsParams,
    body: UpdateOrderMeasurementsBody,
  }),
  async (_req, res) => {
    const { orderNumber } = res.locals.params as { orderNumber: string };
    const body = res.locals.body as UpdateMeasurementsInput;
    const result = await updateMeasurements(orderNumber, body);
    res.json(UpdateOrderMeasurementsResponse.parse(result));
  },
);

router.post(
  "/orders/:orderNumber/reviews",
  validate({
    params: CreateOrderReviewParams,
    body: CreateOrderReviewBody,
  }),
  async (_req, res) => {
    const { orderNumber } = res.locals.params as { orderNumber: string };
    const body = res.locals.body as CreateReviewInput;
    const result = await submitOrderReview(orderNumber, body);
    res.status(201).json(CreateOrderReviewResponse.parse(result));
  },
);

router.post(
  "/orders/:orderNumber/cancellation-requests",
  validate({
    params: CreateOrderCancellationRequestParams,
    body: CreateOrderCancellationRequestBody,
  }),
  async (_req, res) => {
    const { orderNumber } = res.locals.params as { orderNumber: string };
    const body = res.locals.body as CreateCancellationInput;
    const result = await submitOrderCancellationRequest(orderNumber, body);
    res.status(201).json(CreateOrderCancellationRequestResponse.parse(result));
  },
);

export default router;
