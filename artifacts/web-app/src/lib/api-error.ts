/**
 * The server's own message for a failed request, when it sent one.
 *
 * The generated client rejects with the parsed body on `data`, and every error
 * the API raises carries `{ error }` (the `ErrorEnvelope` contract). Showing
 * that message verbatim is what lets the server own its wording — the studio's
 * refusals in particular are written to be read by the person who hit them.
 * Returns undefined when there is no usable message, so each caller decides
 * what to say instead.
 */
export function serverErrorMessage(error: unknown): string | undefined {
  const data = (error as { data?: unknown } | null)?.data;
  const message = (data as { error?: unknown } | null)?.error;
  return typeof message === "string" && message.trim() ? message : undefined;
}
