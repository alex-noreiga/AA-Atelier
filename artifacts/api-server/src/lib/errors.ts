// Domain error types thrown by services and translated to HTTP responses by
// the central error-handling middleware (`middlewares/error.ts`).

/** A requested resource does not exist. Maps to a 404 response. */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}
