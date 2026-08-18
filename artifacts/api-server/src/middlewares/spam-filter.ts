// Invisible anti-spam filter for the public, anonymous submission forms
// (contact, back-in-stock notify, newsletter). Two zero-friction signals, both
// carried as optional fields on the already-validated request body:
//
//   1. Honeypot — a hidden `website` field a real visitor never sees or fills.
//      A non-empty value is a bot.
//   2. Timing — `elapsedMs`, how long the visitor spent on the form. A submit
//      faster than a human plausibly could is a bot. Missing ⇒ treated as human
//      (fail open), so a client that can't measure it still works.
//
// A flagged request is dropped *silently with a success-looking response* — no
// Notion write, no email — rather than a 4xx, so a bot gets no signal it was
// caught and never learns to evade. Real form fields are untouched, so no
// service or Notion-blocks change is needed; the extra body props are ignored
// downstream.
//
// This runs AFTER `validate` (it reads the parsed `res.locals.body`). The timing
// threshold is read fresh from the environment per request (mirroring
// `lib/resend/config.ts`); unset ⇒ the default, so it's inert-safe in dev/test.

import type { RequestHandler } from "express";
import { logger } from "../lib/logger.js";

const DEFAULT_MIN_FILL_MS = 2000;

// Minimum plausible human fill time, in ms. `SPAM_MIN_FILL_MS=0` disables the
// timing check (honeypot still applies).
function minFillMs(): number {
  const raw = process.env.SPAM_MIN_FILL_MS;
  if (raw == null || raw === "") return DEFAULT_MIN_FILL_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_MIN_FILL_MS;
}

interface SpamSignals {
  website?: unknown;
  elapsedMs?: unknown;
}

// Pure predicate — exported for unit testing without an HTTP round-trip.
export function isLikelySpam(body: SpamSignals): boolean {
  // Honeypot: any non-empty value in the hidden field.
  if (typeof body.website === "string" && body.website.trim() !== "") {
    return true;
  }
  // Timing: an implausibly fast submit. Absent/unmeasurable ⇒ not spam.
  if (typeof body.elapsedMs === "number" && body.elapsedMs < minFillMs()) {
    return true;
  }
  return false;
}

interface SuccessResponse {
  status: number;
  body: unknown;
}

// Middleware factory. `success` is the exact response the wrapped endpoint would
// have returned on a real submission, so a dropped bot sees an indistinguishable
// result.
export function spamFilter(success: SuccessResponse): RequestHandler {
  return (req, res, next) => {
    const body = (res.locals.body ?? req.body ?? {}) as SpamSignals;
    if (isLikelySpam(body)) {
      logger.info(
        { ip: req.ip, path: req.path },
        "Dropped a likely-spam submission (honeypot/timing)",
      );
      res.status(success.status).json(success.body);
      return;
    }
    next();
  };
}
