// What each payment stage is CALLED, per service.
//
// The invoice holds the same three stages for every custom order — a first
// deposit, a second deposit, and the final balance — because they are Notion
// properties on "invoices & payments", not something a service gets to redefine.
// What a service does get to decide is the wording, and the wording matters:
// "First deposit" on an $85 repair tells a customer there is a second instalment
// coming, which is a promise the atelier never made.
//
// So this is a pure relabeller over the deposits the invoice already yielded
// (`extractInvoiceDeposits`). It never adds, removes, reorders or reprices a
// stage — `invoice.schema.ts` stays the one place that decides which stages
// exist and what they cost. Kept apart from the schema for the usual reason: the
// schema maps a Notion page and knows nothing about the order, while the label
// depends on the order's service, which only the service layer has.
//
// Applied in `getInvoicePaymentInfo` (the tracking page + account portal) and in
// the payment-reminder pass (the due-payment email), so a customer reads the
// same word for the same money in both places.

import type { PaymentSchedule } from "../lib/service-catalog.js";
import type {
  DepositStage,
  InvoiceDepositView,
  PaymentStage,
} from "../lib/notion/invoice.schema.js";

/**
 * The label for one payment stage.
 *
 * `staged` returns the invoice's own labels unchanged — the bespoke
 * commission's schedule is what those property names were written for.
 *
 * `single` renames the balance to the plainer "Balance" and, when the first
 * deposit is the ONLY one set, calls it just "Deposit". The
 * `soleDeposit` condition is the load-bearing part: if the atelier has
 * deliberately staged two deposits on a big restoration, "First deposit" /
 * "Second deposit" is accurate and the ordinal is exactly what stops the
 * customer paying one and thinking they are square. Renaming unconditionally
 * would produce two payments both called "Deposit".
 */
export function paymentStageLabel(
  stage: PaymentStage,
  schedule: PaymentSchedule,
  fallback: string,
  options: { soleDeposit?: boolean } = {},
): string {
  if (schedule !== "single") return fallback;
  if (stage === "balance") return "Balance";
  if (stage === "first_deposit" && options.soleDeposit) return "Deposit";
  return fallback;
}

/**
 * Relabel an invoice's deposits for the order's service. Returns the list
 * unchanged for a staged service, and a new list (never a mutation — the
 * records come from a cached read) for a single-payment one.
 */
export function labelDeposits(
  deposits: InvoiceDepositView[],
  schedule: PaymentSchedule,
): InvoiceDepositView[] {
  if (schedule !== "single") return deposits;
  const soleDeposit = deposits.length === 1;
  return deposits.map((deposit) => ({
    ...deposit,
    label: paymentStageLabel(
      deposit.stage satisfies DepositStage,
      schedule,
      deposit.label,
      { soleDeposit },
    ),
  }));
}
