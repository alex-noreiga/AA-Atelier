// Bounded retry for **read-only** Google API calls.
//
// Google's backends return transient failures that succeed on an immediate
// re-try — a 503 "The service is currently unavailable" from Sheets is the
// common one, plus 429 rate limiting and the occasional 500/502/504. Without a
// retry a single blip fails the whole request: on a cold serverless instance
// there is no warm cache to fall back to, so one bad Sheets response takes the
// booking flow down for that visitor.
//
// Deliberately small (3 attempts, ~250ms then ~500ms): a Vercel request has a
// time budget and a customer is waiting on the other end.
//
// Only safe for idempotent reads — never wrap a calendar event insert/patch
// with it, or a retried "failure" that actually landed would double-book.

/** Statuses worth retrying: rate limiting + the transient server-side 5xx. */
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 250;

export function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUSES.has(status);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RetryOptions {
  /** Total attempts, including the first. */
  attempts?: number;
  /** Delay before the second attempt; doubled for each further one. */
  baseDelayMs?: number;
}

/**
 * Call `send` until it yields a non-retryable response, retrying transient
 * statuses and thrown network errors with exponential backoff.
 *
 * Returns the last response when the attempts run out (the caller decides how
 * to report it), and rethrows the last thrown error if every attempt threw.
 */
export async function fetchWithRetry(
  send: () => Promise<Response>,
  {
    attempts = DEFAULT_ATTEMPTS,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
  }: RetryOptions = {},
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let response: Response | undefined;
    try {
      response = await send();
      if (!isRetryableStatus(response.status)) return response;
    } catch (error) {
      // A network/DNS/socket failure is transient in the same way a 503 is.
      lastError = error;
    }

    if (attempt === attempts) {
      if (response) return response;
      throw lastError;
    }
    await sleep(baseDelayMs * 2 ** (attempt - 1));
  }

  // Unreachable: the final attempt above always returns or throws.
  throw lastError;
}
