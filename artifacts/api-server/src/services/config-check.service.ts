// Nightly config-drift check, independent of HTTP.
//
// Several features name a specific live Notion option value in code (the shop's
// size-chart categories, the sellable STATUS_IN_STOCK, the measurement-lock
// stage). When the atelier renames or removes that option in Notion, the name
// stops matching and the feature quietly breaks — with no error and no test
// failure (that's how the "Dresses" → "Dress" size-chart bug reached prod).
//
// This check reads the live options and compares them to the code constants
// (config-audit.ts). On drift it logs an error AND emails the atelier inbox
// best-effort, so a rename gets a same-day nudge instead of a silent bug. It is
// read-only and side-effect-light; the email, like every other, is best-effort.

import { fetchInventoryOptionSets } from "../lib/notion/products.repository.js";
import { listOrderStages } from "../lib/notion/orders.repository.js";
import { STATUS_IN_STOCK } from "../lib/notion/products.schema.js";
import { lockFromStage } from "./measurement-lock.js";
import {
  auditNotionConfig,
  type ConfigDriftFinding,
} from "../lib/config-audit.js";
import { configDriftNotificationEmail } from "../lib/resend/emails.js";
import { sendEmailBestEffort } from "../lib/resend/send.js";
import { fromAddress, atelierInbox } from "../lib/resend/config.js";
import { logger } from "../lib/logger.js";

/**
 * Run the config-drift check and, on any finding, log it and email the atelier
 * (best-effort). Returns the findings so the cron handler can report a summary.
 */
export async function runConfigCheck(): Promise<{
  findings: ConfigDriftFinding[];
}> {
  const [{ itemTypeOptions, statusOptions }, stageOptions] = await Promise.all([
    fetchInventoryOptionSets(),
    listOrderStages(),
  ]);

  const findings = auditNotionConfig({
    itemTypeOptions,
    statusOptions,
    stageOptions,
    statusInStock: STATUS_IN_STOCK,
    measurementLockStage: lockFromStage(),
  });

  if (findings.length === 0) {
    return { findings };
  }

  logger.error(
    { findings },
    "Config drift: Notion options that website features depend on are missing " +
      "(likely a renamed/removed option). Emailing the atelier.",
  );

  const to = atelierInbox("orders");
  if (to) {
    await sendEmailBestEffort({
      ...configDriftNotificationEmail(findings, to),
      from: fromAddress("orders"),
    });
  } else {
    // No inbox configured — the log above is the only signal.
    logger.error(
      "Config drift found but ATELIER_INBOX_EMAIL is unset, so no email was " +
        "sent. Set it to be notified of Notion config drift.",
    );
  }

  return { findings };
}
