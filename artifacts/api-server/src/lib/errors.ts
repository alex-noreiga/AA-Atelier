// Domain error types thrown by services and translated to HTTP responses by
// the central error-handling middleware (`middlewares/error.ts`).

/** A requested resource does not exist. Maps to a 404 response. */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

/**
 * A request that passed schema validation but violates a cross-field business
 * rule (which the flat, generated zod schemas can't express). Maps to a 400
 * response with the same `{ error }` envelope a zod failure produces.
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/**
 * The request was well-formed but cannot be fulfilled — e.g. a checkout item
 * that is sold out or has no listed price. Maps to a 400 response, carrying a
 * customer-safe message (unlike an unhandled 500, whose message is generic).
 */
export class BadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadRequestError";
  }
}
