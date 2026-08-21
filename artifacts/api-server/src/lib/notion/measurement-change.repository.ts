// Measurement-change request persistence. Like back-in-stock requests, these
// share the "Website Contact Messages" database with contact-form messages —
// same inbox, distinguished by the "Request type" property — so this reuses the
// contact client and needs no database id of its own. The write path is the
// shared `contactDatabaseWriter` (see contact-writer.ts).

import { contactDatabaseWriter } from "./contact-writer.js";
import {
  buildMeasurementChangeProperties,
  type MeasurementChangeRow,
} from "./measurement-change.blocks.js";

export const createMeasurementChangeRequest =
  contactDatabaseWriter<MeasurementChangeRow>(
    buildMeasurementChangeProperties,
    "measurement-change request",
  );
