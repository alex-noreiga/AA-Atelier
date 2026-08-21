// Newsletter opt-in persistence. Shares the "Website Contact Messages" database
// with the contact-form / back-in-stock / measurement-change writers — same
// inbox, distinguished by the "Request type" property — so this reuses the
// contact client and needs no database id of its own. The write path is the
// shared `contactDatabaseWriter` (see contact-writer.ts).

import { contactDatabaseWriter } from "./contact-writer.js";
import {
  buildNewsletterProperties,
  type CreateNewsletterInput,
} from "./newsletter.blocks.js";

export const createNewsletterSubscription =
  contactDatabaseWriter<CreateNewsletterInput>(
    buildNewsletterProperties,
    "newsletter subscription",
  );
