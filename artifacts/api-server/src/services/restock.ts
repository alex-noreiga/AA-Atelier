// The back-in-stock business rules, kept pure (no I/O) so the "is this piece
// actually back for THIS customer?" question and the shop deep link are
// independently unit-testable — the same split as `measurement-lock.ts` /
// `fitting-reminder.ts`, with the orchestration living in
// `restock-notification.service.ts`.

import type { VariantRecord } from "../lib/notion/products.schema.js";
import { shopCardId } from "./products.service.js";

/**
 * Whether `variant` being back in stock actually answers a request for
 * `requestedSize`.
 *
 * The gate is deliberately conservative — it fails toward NOT emailing, because
 * a wrong "it's back!" note sends a customer to a sold-out page, while a missed
 * one leaves the request sitting un-notified in the inbox where the atelier can
 * still see it:
 *
 *   - the variant itself must be available (In Stock and not at zero quantity —
 *     `computeVariantAvailability` already folded that into `available`);
 *   - a request with no size (the whole variant was sold out) is answered by the
 *     variant being back;
 *   - a variant that tracks no size bands at all can only be answered whole;
 *   - otherwise the exact band asked for must be back — a band that has since
 *     been dropped from the row doesn't count.
 */
export function restockSatisfiesRequest(
  variant: Pick<VariantRecord, "available" | "sizes">,
  requestedSize: string,
): boolean {
  if (!variant.available) return false;
  if (!requestedSize) return true;
  if (variant.sizes.length === 0) return true;
  return variant.sizes.some(
    (size) => size.name === requestedSize && size.available,
  );
}

/**
 * Absolute URL of the shop card this variant appears on, when `PUBLIC_BASE_URL`
 * is set (the same base every other email link uses; unset ⇒ the email simply
 * omits its button). The path is `shopCardId`'s, so the link can't drift from
 * the id `/shop/:productId` actually addresses.
 */
export function shopProductUrl(
  variant: Pick<VariantRecord, "id" | "group">,
): string | undefined {
  const base = process.env.PUBLIC_BASE_URL?.trim();
  if (!base) return undefined;
  return `${base.replace(/\/+$/, "")}/shop/${encodeURIComponent(shopCardId(variant))}`;
}
