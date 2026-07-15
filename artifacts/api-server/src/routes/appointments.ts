import { Router } from "express";
import type { z } from "zod";
import {
  GetAppointmentOptionsResponse,
  GetAppointmentAvailabilityQueryParams,
  GetAppointmentAvailabilityResponse,
  CreateAppointmentBody,
  CreateAppointmentResponse,
} from "@workspace/api-zod";
import { validate } from "../middlewares/validate.js";
import {
  getAppointmentOptions,
  getAppointmentAvailability,
  bookAppointment,
} from "../services/appointments.service.js";

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

export default router;
