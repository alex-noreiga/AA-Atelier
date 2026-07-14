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
