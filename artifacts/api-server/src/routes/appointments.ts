import { Router } from "express";
import type { z } from "zod";
import {
  GetAppointmentOptionsResponse,
  GetAppointmentAvailabilityQueryParams,
  GetAppointmentAvailabilityResponse,
  CreateAppointmentBody,
  CreateAppointmentResponse,
  GetAppointmentQueryParams,
  GetAppointmentResponse,
  RescheduleAppointmentBody,
  RescheduleAppointmentResponse,
  CancelAppointmentBody,
  CancelAppointmentResponse,
} from "@workspace/api-zod";
import { validate } from "../middlewares/validate.js";
import {
  getAppointmentOptions,
  getAppointmentAvailability,
  bookAppointment,
} from "../services/appointments.service.js";
import {
  getAppointmentForManage,
  rescheduleAppointment,
  cancelAppointment,
} from "../services/appointment-manage.service.js";

const router = Router();

router.get("/appointments/options", async (_req, res) => {
  const result = getAppointmentOptions();
  res.json(GetAppointmentOptionsResponse.parse(result));
});

router.get(
  "/appointments/availability",
  validate({ query: GetAppointmentAvailabilityQueryParams }),
  async (_req, res) => {
    const params = res.locals.query as z.infer<
      typeof GetAppointmentAvailabilityQueryParams
    >;
    const result = await getAppointmentAvailability(params);
    res.json(GetAppointmentAvailabilityResponse.parse(result));
  },
);

router.post(
  "/appointments",
  validate({ body: CreateAppointmentBody }),
  async (_req, res) => {
    const body = res.locals.body as z.infer<typeof CreateAppointmentBody>;
    const result = await bookAppointment(body);
    res.status(201).json(CreateAppointmentResponse.parse(result));
  },
);

// Self-service reschedule / cancel, all keyed off the signed token in the manage
// link the confirmation email carries (identity is the token, like the account
// magic link — see appointment-manage.service.ts).
router.get(
  "/appointments/manage",
  validate({ query: GetAppointmentQueryParams }),
  async (_req, res) => {
    const { token } = res.locals.query as z.infer<
      typeof GetAppointmentQueryParams
    >;
    const result = await getAppointmentForManage(token);
    res.json(GetAppointmentResponse.parse(result));
  },
);

router.post(
  "/appointments/reschedule",
  validate({ body: RescheduleAppointmentBody }),
  async (_req, res) => {
    const { token, start } = res.locals.body as z.infer<
      typeof RescheduleAppointmentBody
    >;
    const result = await rescheduleAppointment(token, start);
    res.json(RescheduleAppointmentResponse.parse(result));
  },
);

router.post(
  "/appointments/cancel",
  validate({ body: CancelAppointmentBody }),
  async (_req, res) => {
    const { token } = res.locals.body as z.infer<typeof CancelAppointmentBody>;
    await cancelAppointment(token);
    res.json(
      CancelAppointmentResponse.parse({
        message: "Your appointment has been cancelled.",
      }),
    );
  },
);

export default router;
