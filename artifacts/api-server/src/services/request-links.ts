// Feature gate for the Phase-2 "relate, don't just name" workspace cards: the
// customer-request rows (measurement-change / cancellation / return / review) and
// the shop order gain a real Notion *relation* to the order / inventory row they
// concern, instead of only naming it in free text.
//
// Why a gate: the app writes to EXISTING Notion properties — writing a relation
// property that doesn't exist yet 400s the whole page-create. These relation
// properties are added to the Notion databases out-of-band; until the atelier
// confirms they exist and sets `NOTION_RELATION_LINKS`, the writers omit the
// relation and behave exactly as before (the order is still named in free text).
// This decouples the code deploy from the Notion schema change and keeps the
// feature degrade-safe, the same "optional, unset ⇒ no-op" contract as the
// optional Client CRM link.
//
// Read fresh from env at call time (like `lib/resend/config.ts`) so it flips
// without a redeploy and stays inert in dev/test where it's unset.

/**
 * Whether to write the new order/inventory relations on request + shop-order
 * rows. Enabled when `NOTION_RELATION_LINKS` is a truthy value (`1` / `true` /
 * `yes`, case-insensitive); unset or anything else ⇒ disabled.
 */
export function relationLinksEnabled(): boolean {
  const raw = process.env.NOTION_RELATION_LINKS?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}
