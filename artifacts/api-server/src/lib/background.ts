// Running best-effort work *after* the response, without losing it.
//
// Several endpoints finish by doing work the response does not depend on — the
// order-confirmation and atelier-notification emails being the clearest case:
// `sendEmailBestEffort` swallows its own failures, so the status and body are
// identical whether the send succeeds, fails, or never happens. Awaiting them
// inline still made the customer wait for two Resend round-trips before their
// order number appeared (production logs put `POST /api/orders` at 1.6-3.0s,
// on warm instances).
//
// A bare fire-and-forget is wrong on serverless: once the response is sent the
// platform may freeze or reclaim the instance, and the in-flight send would
// simply never complete — trading a slow email for a silently missing one. The
// platform's `waitUntil` is the supported way to say "respond now, but keep me
// alive until this settles".
//
// So: hand the work to `waitUntil` when the platform offers one, and otherwise
// await it inline exactly as before. That fallback is the load-bearing part.
// The hook is read from the request-context global that `@vercel/functions`
// itself reads, rather than taking on the dependency; if Vercel ever moves it,
// `platformWaitUntil()` returns null and every caller quietly goes back to
// today's behaviour. The failure mode of guessing wrong is a slower response,
// never an unsent email.

import { logger } from "./logger.js";

type WaitUntil = (promise: Promise<unknown>) => void;

/** The key Vercel's Node runtime publishes its per-request context under. */
const REQUEST_CONTEXT = Symbol.for("@vercel/request-context");

interface RequestContextHolder {
  get?: () => { waitUntil?: WaitUntil } | undefined;
}

/**
 * The platform's `waitUntil`, or null when there isn't one (local dev, tests,
 * or a runtime that no longer exposes it). Defensive throughout: anything
 * unexpected reads as "no hook", which routes the caller to the inline path.
 */
function platformWaitUntil(): WaitUntil | null {
  try {
    const holder = (
      globalThis as unknown as Record<symbol, RequestContextHolder | undefined>
    )[REQUEST_CONTEXT];

    const context = holder?.get?.();
    const waitUntil = context?.waitUntil;

    return typeof waitUntil === "function" ? waitUntil.bind(context) : null;
  } catch {
    return null;
  }
}

/**
 * Run `task` off the response path when the platform supports it.
 *
 * Resolves immediately once the work is handed to `waitUntil`; otherwise
 * resolves when the work does. Either way it never rejects — `task` is
 * best-effort by definition, so a throw is logged and swallowed rather than
 * turned into a failed request (or, worse, an unhandled rejection after the
 * response has already gone out).
 *
 * `label` names the work in that log line; make it something you would want to
 * read in production, e.g. `"order confirmation emails"`.
 */
export async function deferBestEffort(
  label: string,
  task: () => Promise<unknown>,
): Promise<void> {
  const running = Promise.resolve()
    .then(task)
    .catch((err: unknown) => {
      logger.error({ err, task: label }, `Deferred task failed: ${label}`);
    });

  const waitUntil = platformWaitUntil();
  if (!waitUntil) {
    // No platform hook — keep the old contract and finish before responding.
    await running;
    return;
  }

  try {
    waitUntil(running);
  } catch (err) {
    // A hook that exists but rejects the handoff must not strand the work.
    logger.warn(
      { err, task: label },
      `waitUntil refused the handoff; running "${label}" inline`,
    );
    await running;
  }
}
