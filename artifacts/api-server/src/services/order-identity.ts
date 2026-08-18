// Shared customer-identity gate for the "a customer asks about their own order"
// flows (measurement-change, review, return, cancellation). Each verifies the
// supplied email against the one stored on the order the same way, so the rule
// lives here once.

import { ForbiddenError } from "../lib/errors.js";

/**
 * Verify a supplied email against the order's stored email, case-insensitively
 * and trimmed. Returns whether the identity is **verified**:
 *   - stored email matches supplied  → `true`
 *   - no stored email (a legacy order predating the `Email` property) → `false`
 *     (accepted, but the caller flags the row "unverified" for the atelier to vet)
 *   - stored email present but different → throws {@link ForbiddenError} (→ 403)
 */
export function resolveEmailVerification(
  storedEmail: string,
  suppliedEmail: string,
): boolean {
  const stored = storedEmail.trim().toLowerCase();
  const supplied = suppliedEmail.trim().toLowerCase();
  if (!stored) return false;
  if (stored === supplied) return true;
  throw new ForbiddenError("That email doesn't match the one on this order.");
}
