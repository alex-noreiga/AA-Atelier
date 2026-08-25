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

/** The caller isn't allowed to perform the action (e.g. the email supplied for
 * a measurement-change request doesn't match the one on the order). Maps to a
 * 403 response. */
export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** The request conflicts with the resource's current state — measurements can
 * no longer be changed because the garment has entered production. Maps to a
 * 409 response. */
export class MeasurementsLockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MeasurementsLockedError";
  }
}

/** The caller isn't authenticated — the account portal was reached without a
 * valid Bearer access token (JWT). Maps to a 401 response; the frontend
 * redirects to the sign-in page. */
export class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/** The request conflicts with the resource's current state in a general way —
 * e.g. an order can't be reviewed until it has been delivered. Maps to a 409
 * response, carrying a customer-safe message. */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

/**
 * A required upstream service is temporarily unreachable and the request can't
 * be served from cache — today: the Google Sheet holding staff working hours,
 * which Google's backend intermittently 503s. Maps to a 503 response carrying a
 * retriable, customer-safe message, and is deliberately NOT reported as an
 * unhandled 500 (a transient Google outage isn't a bug in this app, and would
 * otherwise fire an alert email per request).
 */
export class ServiceUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ServiceUnavailableError";
  }
}

/**
 * The orders database has no property to write a measurement into, so an
 * in-place edit had nowhere to store what the customer typed.
 *
 * This is the exact state {@link createPageDroppingUnknownProperties} degrades
 * past at intake — but the two must answer differently. There, dropping the
 * field keeps the order and the values survive in the page body, so the right
 * move is a warn. Here the value IS the write: reporting success for a save
 * that stored nothing would tell a customer their new measurements are on file
 * when the atelier will still cut to the old ones. So it throws, and the
 * measurement-update service turns it into an answer the customer can act on
 * (file a change request instead) and a `warn` naming the property to add.
 *
 * The service translates it into a `ConflictError` (409) rather than the error
 * middleware doing so: the request is well-formed and will succeed unchanged
 * once the atelier adds the property — a conflict with the workspace's current
 * state, not a fault of the caller's — and the translation is where the
 * operator-facing `warn` naming the property belongs.
 */
export class MeasurementPropertiesMissingError extends Error {
  /** The Notion property the database is missing, for the operator-facing log. */
  readonly property: string;

  constructor(property: string) {
    super(
      `The orders database has no "${property}" property to record measurements in.`,
    );
    this.name = "MeasurementPropertiesMissingError";
    this.property = property;
  }
}
