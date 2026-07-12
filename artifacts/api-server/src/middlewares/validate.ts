// Reusable request-validation middleware. Runs the generated zod schemas
// (from `@workspace/api-zod`) against the request and stashes the parsed,
// typed values on `res.locals` for the handler. Validation failures are passed
// to the central error handler, which renders a consistent error envelope.

import type { RequestHandler } from "express";
import type { ZodTypeAny } from "zod";

interface ValidateSchemas {
  params?: ZodTypeAny;
  body?: ZodTypeAny;
}

export function validate(schemas: ValidateSchemas): RequestHandler {
  return (req, res, next) => {
    try {
      if (schemas.params) {
        res.locals.params = schemas.params.parse(req.params);
      }
      if (schemas.body) {
        res.locals.body = schemas.body.parse(req.body);
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
