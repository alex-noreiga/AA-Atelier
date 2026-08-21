// Contact-message persistence against the separate "Website Contact Messages"
// Notion database. The write path itself is the shared `contactDatabaseWriter`
// (see contact-writer.ts) — this file supplies only the properties builder and
// the label its errors are named for.

import { contactDatabaseWriter } from "./contact-writer.js";
import {
  buildContactProperties,
  type CreateContactInput,
} from "./contact.blocks.js";

export const createContactMessage = contactDatabaseWriter<CreateContactInput>(
  buildContactProperties,
  "contact-message",
);
