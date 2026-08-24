// Waitlist persistence. Shares the "Website Contact Messages" database with the
// other six request writers — same inbox, distinguished by the "Request type"
// property — so this reuses the contact client and needs no database id of its
// own. The write path is the shared `contactDatabaseWriter`.

import { contactDatabaseWriter } from "./contact-writer.js";
import {
  buildWaitlistProperties,
  type CreateWaitlistInput,
  type WaitlistTarget,
} from "./waitlist.blocks.js";

export const createWaitlistEntry = contactDatabaseWriter<
  CreateWaitlistInput & { target?: WaitlistTarget }
>(buildWaitlistProperties, "waitlist entry");
