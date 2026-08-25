// Creating a Notion page whose optional properties may not exist yet.
//
// Notion rejects a page create that names a property the database doesn't have
// — and it rejects the WHOLE page, not the offending field. Every additive
// property this app writes is atelier setup somebody has to do by hand in
// Notion, so without this, shipping a new field breaks the write it rides on
// until that setup happens.
//
// Dropping the field and keeping the page is the right way to be wrong. The
// record survives (and the page body, which carries the same values as text,
// still reads correctly), and the `warn` names the property to add. Bounded, so
// a persistent 400 that isn't a missing property still surfaces as an error.
//
// This began as a private helper on the orders repository, for the intake
// form's growing list of optional properties. It moved here when the shop-order
// writer needed the same protection: that one runs on the STRIPE WEBHOOK, where
// a 400 costs a paid order its Notion row — Stripe retries, the retry
// early-returns at the dedupe guard, and the order is simply lost. A property
// the atelier hasn't added yet must never be able to do that.

import type { NotionClient } from "./client.js";
import { logger } from "../logger.js";

/** Notion's message when a page names a property the database doesn't have. */
const UNKNOWN_PROPERTY_PATTERN = /^(.+?) is not a property that exists/;

/** How many properties may be dropped before a 400 is taken at face value. */
const MAX_ATTEMPTS = 5;

/**
 * Create a page, dropping any property the database doesn't have yet and
 * retrying.
 *
 * `label` names the database in the warning ("orders", "shop orders"), so the
 * reader of the log knows where to go and add the property.
 */
export async function createPageDroppingUnknownProperties(
  client: NotionClient,
  properties: Record<string, unknown>,
  children: unknown[],
  label: string,
  maxAttempts = MAX_ATTEMPTS,
): Promise<{ id: string }> {
  let remaining = properties;

  for (let attempt = 0; ; attempt += 1) {
    const response = await client.fetch("/v1/pages", {
      method: "POST",
      body: JSON.stringify({
        parent: { database_id: client.databaseId },
        properties: remaining,
        children,
      }),
    });

    if (response.ok) {
      return (await response.json()) as { id: string };
    }

    const errorText = await response.text();
    const missing =
      attempt + 1 < maxAttempts
        ? findUnknownProperty(errorText, remaining)
        : undefined;
    if (!missing) {
      throw new Error(
        `Notion page creation failed with status ${response.status}: ${errorText}`,
      );
    }

    logger.warn(
      { property: missing, database: label },
      `The ${label} database has no such property; recording the page without it. Add the property in Notion to capture this field.`,
    );
    const { [missing]: _dropped, ...rest } = remaining;
    remaining = rest;
  }
}

/** The name of the property Notion rejected, when it is one we sent. Matching
 * against what we sent keeps an unrelated 400 from being read as a missing
 * property (and looping). */
function findUnknownProperty(
  errorText: string,
  properties: Record<string, unknown>,
): string | undefined {
  let message: string;
  try {
    message = String(
      (JSON.parse(errorText) as { message?: unknown }).message ?? "",
    );
  } catch {
    return undefined;
  }

  const name = UNKNOWN_PROPERTY_PATTERN.exec(message)?.[1];
  return name && name in properties ? name : undefined;
}
