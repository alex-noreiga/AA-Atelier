// Central error handler, registered last on the app. Route handlers `throw`
// (or reject) and this maps the error to a consistent HTTP response:
//   - zod validation errors           -> 400 ErrorEnvelope  { error }
//   - ValidationError                 -> 400 ErrorEnvelope  { error }
//   - BadRequestError                  -> 400 ErrorEnvelope  { error }
//   - NotFoundError                    -> 404 OrderNotFound  { message }
//   - ForbiddenError                   -> 403 ErrorEnvelope  { error }
//   - MeasurementsLockedError          -> 409 ErrorEnvelope  { error }
//   - anything else                    -> 500 ErrorEnvelope  { error }

import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import type { ErrorEnvelope, OrderNotFound } from "@workspace/api-zod";
import {
  BadRequestError,
  NotFoundError,
  ValidationError,
  ForbiddenError,
  MeasurementsLockedError,
} from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { reportError } from "../services/alert.service.js";

export const errorHandler: ErrorRequestHandler = async (
  err,
  req,
  res,
  next,
) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof ZodError) {
    logger.warn({ err }, "Request validation failed");
    const body: ErrorEnvelope = { error: err.message };
    res.status(400).json(body);
    return;
  }

  if (err instanceof ValidationError) {
    logger.warn({ err }, "Request validation failed");
    const body: ErrorEnvelope = { error: err.message };
    res.status(400).json(body);
    return;
  }

  if (err instanceof BadRequestError) {
    const body: ErrorEnvelope = { error: err.message };
    res.status(400).json(body);
    return;
  }

  if (err instanceof NotFoundError) {
    const body: OrderNotFound = { message: err.message };
    res.status(404).json(body);
    return;
  }

  if (err instanceof ForbiddenError) {
    const body: ErrorEnvelope = { error: err.message };
    res.status(403).json(body);
    return;
  }

  if (err instanceof MeasurementsLockedError) {
    const body: ErrorEnvelope = { error: err.message };
    res.status(409).json(body);
    return;
  }

  // Log AND email an alert for the unhandled failure. Awaited before the response
  // so the send flushes on serverless (the function is frozen once the response
  // is returned). reportError is best-effort and never throws.
  const requestId = (req as { id?: unknown }).id;
  await reportError(
    {
      err,
      method: req.method,
      path: req.path,
      ...(typeof requestId === "string" ? { requestId } : {}),
      statusCode: 500,
    },
    "Unhandled error",
  );
  const body: ErrorEnvelope = {
    error: "Something went wrong. Please try again later.",
  };
  res.status(500).json(body);
};
