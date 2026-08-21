// Return / exchange request persistence. Like back-in-stock and
// measurement-change requests, these share the "Website Contact Messages"
// database with contact-form messages — same inbox, distinguished by the
// "Request type" property — so this reuses the contact client and needs no
// database id of its own. The write path is the shared `contactDatabaseWriter`
// (see contact-writer.ts).

import { contactDatabaseWriter } from "./contact-writer.js";
import {
  buildReturnRequestProperties,
  type ReturnRequestRow,
} from "./return-request.blocks.js";

export const createReturnRequest = contactDatabaseWriter<ReturnRequestRow>(
  buildReturnRequestProperties,
  "return request",
);
