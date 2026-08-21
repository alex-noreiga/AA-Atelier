// The one writer behind every "Website Contact Messages" row.
//
// Six request types share that database — contact-form inquiries, back-in-stock
// requests, measurement-change requests, newsletter opt-ins, cancellation
// requests, and return/exchange requests — separated only by the "Request type"
// select (see CLAUDE.md, "The contact database has six writers"). Each used to
// carry its own copy of this function: the same config assertion, the same POST
// to /v1/pages, the same non-ok handling, differing only in which
// `build*Properties` it called and one noun in its error message. Six copies
// meant six places to fix a bug in the write path and six near-identical test
// files asserting the same three things.
//
// So the shape lives here once and each repository binds it to its own builder.
// The public signatures are unchanged — `(row, client?, clientPageId?)` with the
// contact client defaulted lazily — as are the error messages, which name the
// request type so a failure still says which writer it came from.

import {
  getContactNotionClient,
  assertDatabaseConfigured,
  type NotionClient,
} from "./client.js";

/** Builds the Notion `properties` payload for one row of a given request type. */
type PropertiesBuilder<T> = (
  row: T,
  clientPageId?: string,
) => Record<string, unknown>;

/** What a bound writer accepts — identical to the six it replaced. */
export type ContactDatabaseWriter<T> = (
  row: T,
  client?: NotionClient,
  clientPageId?: string,
) => Promise<void>;

/**
 * Bind a properties builder to the contact database.
 *
 * `label` is the noun phrase in the thrown message ("cancellation request" =>
 * "Notion cancellation request creation failed with status 400: ..."), so the
 * error still identifies the writer without a stack trace.
 */
export function contactDatabaseWriter<T>(
  build: PropertiesBuilder<T>,
  label: string,
): ContactDatabaseWriter<T> {
  return async function createContactDatabaseRow(
    row: T,
    // Resolved at call time, not bind time: the client reads its env lazily on
    // first use, and the tests swap a fake in per case.
    client: NotionClient = getContactNotionClient(),
    clientPageId?: string,
  ): Promise<void> {
    assertDatabaseConfigured(
      client,
      "NOTION_CONTACT_DATABASE_ID is not configured for the contact database",
    );

    const body: Record<string, unknown> = {
      parent: { database_id: client.databaseId },
      properties: build(row, clientPageId),
    };

    const response = await client.fetch("/v1/pages", {
      method: "POST",
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Notion ${label} creation failed with status ${response.status}: ${errorText}`,
      );
    }
  };
}
