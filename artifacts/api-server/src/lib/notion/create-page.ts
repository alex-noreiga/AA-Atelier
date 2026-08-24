// Creating a Notion page without letting one un-added property lose the record.
//
// Notion rejects the WHOLE page create when it names a property the database
// doesn't have — so every additive property the app writes (`Colors`,
// `Rush Order`, `Delivery Method`, …) is a live footgun: adding one here would
// break intake, or a paid order's webhook, until the atelier adds it in Notion.
// Dropping the field and keeping the record is the right way to be wrong, and
// the `warn` names the property to add.
//
// Shared by the order and shop-order repositories so both degrade identically.

import type { NotionClient } from "./client.js";
import { logger } from "../logger.js";

/** Notion's message when a page names a property the database doesn't have. */
const UNKNOWN_PROPERTY_PATTERN = /^(.+?) is not a property that exists/;

/**
 * Create a page, dropping any property the database doesn't have yet and
 * retrying. Bounded, so a persistent 400 still surfaces as an error, and only a
 * property we actually sent is ever dropped — an unrelated 400 must not be read
 * as a missing property (and loop).
 *
 * `label` names the database in the warn, so the log says which Notion database
 * needs the property added.
 */
export async function createPageDroppingUnknownProperties(
  client: NotionClient,
  properties: Record<string, unknown>,
  children: unknown[],
  label = "orders",
  maxAttempts = 5,
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
      `The ${label} database has no such property; recording without it. Add the property in Notion to capture this field.`,
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
