/**
 * Format a shop price. Notion's "Listed Price" is optional — an unpriced item
 * can't be bought online and instead invites an enquiry. Whole dollars stay
 * clean ("$22"); anything with cents shows both ("$22.50").
 */
export function formatPrice(price?: number): string {
  if (typeof price !== "number") return "inquire for price";
  return price.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(price) ? 0 : 2,
  });
}

/**
 * Format an ISO date (yyyy-mm-dd, e.g. an order's estimated-completion date)
 * for display: "August 1, 2026". Formatted in UTC so a date-only value — which
 * parses as UTC midnight — never slips to the previous day in a western
 * timezone. Returns "" for a missing/unparseable value so callers can skip it.
 */
export function formatDate(iso?: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}
