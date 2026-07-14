// Central error handler, registered last on the app. Route handlers `throw`
// (or reject) and this maps the error to a consistent HTTP response:
//   - zod validation errors           -> 400 ErrorEnvelope  { error }
//   - BadRequestError                  -> 400 ErrorEnvelope  { error }
//   - NotFoundError                    -> 404 OrderNotFound  { message }
//   - anything else                    -> 500 ErrorEnvelope  { error }

import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import type { ErrorEnvelope, OrderNotFound } from "@workspace/api-zod";
import { BadRequestError, NotFoundError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
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

  logger.error({ err }, "Unhandled error");
  const body: ErrorEnvelope = {
    error: "Something went wrong. Please try again later.",
  };
  res.status(500).json(body);
};
