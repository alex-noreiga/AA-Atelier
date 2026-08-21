// The weekly "what's running low" email to the atelier.
//
// The dashboard panel answers the question when someone thinks to look; this is
// the nudge for when nobody does. It is deliberately a DIGEST of current state
// rather than an alert on the moment a material trips:
//
//   * **It needs no record of what it has already said.** A material sits below
//     its reorder point for weeks, so a "tell me when it trips" email would
//     re-send nightly unless something remembered — which is exactly why the
//     back-in-stock sweep needed a Postgres table. Reporting current state is
//     idempotent by construction: run it twice and it says the same true thing.
//   * **It reads as a shopping list**, which is how the atelier actually buys
//     materials — in one trip, not one material at a time.
//
// It rides the nightly reconciliation rather than taking a cron of its own
// (Vercel Hobby caps those, the same reason the reminder passes ride it), and
// fires only on the configured weekday, read in the studio's timezone so "Monday"
// means the atelier's Monday.
//
// Known limit, accepted: the weekday check is the whole guard, so if the nightly
// cron were to fire twice on digest day the atelier would get two copies. That's
// an internal email and a trivial cost — the alternative is a sent-marker store
// for a message that is safe to repeat.

import {
  listMaterials,
  materialsConfigured,
} from "../lib/notion/materials.repository.js";
import { classifyMaterials } from "./materials.service.js";
import {
  materialsDigestEmail,
  type MaterialsDigestItem,
} from "../lib/resend/emails.js";
import { sendEmailBestEffort } from "../lib/resend/send.js";
import { fromAddress, atelierInbox } from "../lib/resend/config.js";
import { appointmentTimezone } from "../lib/appointments/settings.js";
import { dateInZone, weekdayName } from "../lib/appointments/time.js";
import { logger } from "../lib/logger.js";

/** The weekday the digest goes out, as a long name ("Monday", …). A targeted
 * business rule like `FITTING_REMINDER_STAGES`: env-only, with a default that
 * puts the shopping list in front of the atelier at the start of the week. */
const DEFAULT_DIGEST_WEEKDAY = "Monday";

export function materialsDigestWeekday(): string {
  const raw = (process.env.MATERIALS_DIGEST_WEEKDAY ?? "").trim();
  return raw || DEFAULT_DIGEST_WEEKDAY;
}

/** Whether today is the digest's weekday, in the studio's timezone. Exported
 * for its own test — the timezone is the part that's easy to get wrong. */
export function isDigestDay(now: Date, timeZone: string): boolean {
  const today = weekdayName(dateInZone(now, timeZone));
  return today.toLowerCase() === materialsDigestWeekday().toLowerCase();
}

/**
 * Send the weekly digest, when today is its day and there is something to say.
 *
 * @returns how many materials the digest listed; `0` when nothing was sent.
 */
export async function sendWeeklyMaterialsDigest(
  now: Date = new Date(),
): Promise<number> {
  if (!materialsConfigured()) return 0;
  if (!isDigestDay(now, appointmentTimezone())) return 0;

  const inbox = atelierInbox("orders");
  if (!inbox) {
    // No internal inbox configured — the same self-gate every atelier
    // notification has. Nothing to do, and nothing wrong.
    return 0;
  }

  const { lowStock } = classifyMaterials(await listMaterials());
  // Silence when nothing is low. A weekly "all good" would train the atelier to
  // ignore the sender, and the dashboard panel already answers "is anything low?"
  if (lowStock.length === 0) {
    logger.info(
      "Materials digest: nothing below its reorder point; not sending",
    );
    return 0;
  }

  const items: MaterialsDigestItem[] = lowStock.map((material) => ({
    name: material.name,
    stockOnHand: material.stockOnHand,
    minimumStock: material.minimumStock,
    ...(material.category ? { category: material.category } : {}),
    ...(material.link ? { link: material.link } : {}),
  }));

  await sendEmailBestEffort({
    ...materialsDigestEmail(items, inbox),
    from: fromAddress("orders"),
  });

  return items.length;
}
