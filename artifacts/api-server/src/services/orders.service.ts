// Order use-cases, independent of HTTP. Route handlers call these with already
// validated input and turn the results (or thrown domain errors) into responses.

import {
  createOrder,
  findOrderByNumber,
} from "../lib/notion/orders.repository.js";
import { listOrderMilestones } from "../lib/notion/production-schedule.repository.js";
import { upsertClientByEmail } from "../lib/notion/clients.repository.js";
import { postgresConfigured } from "../lib/db/client.js";
import { upsertClientIndex } from "../lib/db/clients.repository.js";
import { writeOrderIndex } from "../lib/db/order-index.repository.js";
import { captureReferralOnOrder } from "./rewards.service.js";
import { recordSmsConsent } from "./sms.service.js";
import { measurementsLocked } from "./measurement-lock.js";
import { orderDelivered } from "./delivery.js";
import { getIntakeStatus } from "./capacity.service.js";
import { closedMessage } from "./capacity.js";
import { getInvoicePaymentInfo } from "./invoice.service.js";
import { resolveFulfilment } from "../lib/fulfilment.js";
import { appointmentTimezone } from "../lib/appointments/settings.js";
import type {
  CreateOrderInput,
  OrderStatusResult,
} from "../lib/notion/orders.schema.js";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../lib/errors.js";
import {
  orderConfirmationEmail,
  orderNotificationEmail,
} from "../lib/resend/emails.js";
import { sendEmailBestEffort } from "../lib/resend/send.js";
import { fromAddress, atelierInbox } from "../lib/resend/config.js";
import { hasAllMeasurements } from "./measurements.js";
import {
  resolveOrderService,
  type OrderServiceDef,
} from "../lib/service-catalog.js";
import { logger } from "../lib/logger.js";
import { deferBestEffort } from "../lib/background.js";

export async function getOrderStatus(
  orderNumber: string,
): Promise<OrderStatusResult> {
  const order = await findOrderByNumber(orderNumber);
  if (!order) {
    throw new NotFoundError("We couldn't find an order with that number.");
  }

  // Derive the production lock from the *raw* record (before the timeline fixup
  // below), so it shares the measurement-change flow's fail-open semantics: a
  // current stage absent from the live list reports unlocked, not locked.
  const locked = measurementsLocked(order.currentStage, order.stages);

  // The current stage may not be present in the live options list (e.g. a
  // renamed/removed option); ensure the timeline still includes it.
  const stages = order.stages.includes(order.currentStage)
    ? order.stages
    : [...order.stages, order.currentStage];

  // Best-effort per-stage target dates from the Production Schedule (keyed by the
  // order's Notion page id). Returns [] when that DB is unconfigured or the query
  // fails, so this never breaks the core lookup. pageId is dropped from the
  // response — it's an internal join key, not part of the contract.
  const milestones = order.pageId
    ? await listOrderMilestones(order.pageId)
    : [];

  // Read the order's invoice once: its staged deposits (payable as soon as the
  // atelier sets an amount) and — only once "Invoice Ready" is flipped — the
  // itemized invoice view. No invoice ⇒ empty deposits + null invoice.
  const { deposits, invoice } = await getInvoicePaymentInfo(order);

  // How the piece reaches the customer: a carrier tracking number and ship-by
  // date, or — for the local skaters who collect in person — their scheduled
  // pickup. Resolved here rather than in the repository because the "has it been
  // delivered?" test needs the order's own pipeline, and dropped entirely on a
  // cancelled order, where the piece isn't coming at all.
  const fulfilment = order.cancelled
    ? undefined
    : resolveFulfilment(order.fulfilmentFields ?? {}, {
        timezone: appointmentTimezone(),
        delivered: orderDelivered(order.currentStage, stages),
      });

  const { pageId, invoicePageId, fulfilmentFields, ...rest } = order;
  return {
    ...rest,
    stages,
    measurementsLocked: locked,
    ...(deposits.length ? { deposits } : {}),
    ...(invoice ? { invoice } : {}),
    ...(milestones.length ? { milestones } : {}),
    ...(fulfilment ? { fulfilment } : {}),
  };
}

/**
 * The per-service intake gate — the order-form counterpart of the appointment
 * flow's `enforceBookingGate`. What an order must carry depends on which service
 * it is for, which a flat request schema can't express, so the catalog decides
 * and this enforces it:
 *
 *   - a service that asks for measurements needs all five, or an explicit
 *     request to have them taken at a fitting/consultation;
 *   - a service performed on a piece the customer already owns needs the
 *     free-text `description` — that text is the brief, not a nicety.
 *
 * An unknown or omitted `service` resolves to a bespoke commission, so a client
 * that predates the catalog keeps the exact rule it always had.
 */
function enforceServiceGate(
  service: OrderServiceDef,
  input: CreateOrderInput,
): void {
  if (
    service.measurements &&
    !input.measurementAppointment &&
    !hasAllMeasurements(input)
  ) {
    throw new ValidationError(
      "Please enter your measurements or request a measurement appointment.",
    );
  }

  if (service.detailsRequired && !input.description?.trim()) {
    throw new ValidationError(
      "Please tell us about the piece and what you'd like done to it.",
    );
  }
}

/**
 * The commission-capacity gate — the server's half of `GET /capacity`.
 *
 * The intake form asks the same question before it renders, so in practice this
 * fires only on a stale tab, a resubmitted form, or a direct POST. It exists
 * anyway for the reason `checkout.service` reprices the cart: a rule the browser
 * is trusted to apply is not a rule. Refusing here is also what makes the
 * capacity number mean something — otherwise the books close for everyone who
 * loads the page fresh and stay open for everyone who already had it.
 *
 * A `ConflictError` (409), not a validation error: nothing about the order is
 * wrong, and the customer may well be able to place the very same order next
 * month. The message is the atelier's own closed wording, so the refusal reads
 * as the page does. Services that aren't capacity-gated skip the check entirely
 * — and with it the Notion read behind it.
 */
async function enforceCapacityGate(service: OrderServiceDef): Promise<void> {
  if (!service.capacityGated) return;

  const { open } = await getIntakeStatus();
  if (!open) {
    throw new ConflictError(closedMessage());
  }
}

export async function submitOrder(
  input: CreateOrderInput,
): Promise<{ orderNumber: string }> {
  const service = resolveOrderService(input.service);
  enforceServiceGate(service, input);
  await enforceCapacityGate(service);

  // Best-effort: mirror the customer into the Client CRM (dedupe by email) so we
  // can link the order to a durable client record. A CRM failure must never fail
  // the order — swallow and log, like the mailers below — and when the CRM db
  // isn't configured `upsertClientByEmail` simply returns null (no link).
  let clientPageId: string | undefined;
  try {
    clientPageId =
      (await upsertClientByEmail({
        fullName: input.fullName,
        email: input.email,
        phone: input.phone,
      })) ?? undefined;
  } catch (err) {
    logger.warn(
      { err },
      "Failed to upsert Client CRM record; creating the order without a client link",
    );
  }

  const { orderNumber, pageId } = await createOrder(
    input,
    undefined,
    clientPageId,
  );

  // Best-effort: index the order in Postgres for the account portal's reliable
  // (case-insensitive, client-joined) order discovery. Notion is the record; a PG
  // hiccup must never fail the order — swallow and log, like the CRM upsert above.
  // No-op when Postgres isn't configured.
  if (postgresConfigured()) {
    try {
      const dbClientId = await upsertClientIndex(
        input.email,
        clientPageId ?? null,
      );
      await writeOrderIndex({
        orderNumber,
        kind: "custom",
        email: input.email,
        notionPageId: pageId,
        clientId: dbClientId,
      });
    } catch (err) {
      logger.warn(
        { err },
        "Failed to write the Postgres order index; the order is recorded in Notion",
      );
    }
  }

  // Best-effort: capture a referral code (if the customer entered one) — stamp
  // the referrer link and email this new customer their welcome discount. A
  // failure (or an unknown/self code, or no CRM) must never fail the order.
  //
  // Deferred for the same reason as the emails below: this is a Notion read, a
  // Notion write, a Stripe promotion-code create and a Resend send, none of
  // which the response depends on. The `try/catch` stays *inside* the deferred
  // task so a referral failure keeps its `warn` level — it is explicitly "the
  // order is unaffected", not the error-level surprise `deferBestEffort` logs.
  if (input.referralCode) {
    const referralCode = input.referralCode;
    const { email } = input;
    await deferBestEffort("referral capture", async () => {
      try {
        await captureReferralOnOrder({ referralCode, email });
      } catch (err) {
        logger.warn(
          { err },
          "Failed to capture referral on order; the order is unaffected",
        );
      }
    });
  }

  // Best-effort: record the customer's text-alert opt-in on their Client CRM
  // row, which is where every send path asks whether they may be texted. The
  // order already carries its own `SMS Consent` checkbox (the atelier's record
  // of what was ticked here); this is the copy that is read.
  //
  // Deferred for the same reason as the referral capture below it — a CRM read
  // plus a write, neither of which the order number waits on — and with the
  // same inner `try/catch`, so a consent that doesn't stick stays a `warn`
  // about an unaffected order rather than the error `deferBestEffort` logs.
  // `recordSmsConsent` swallows its own failures too; this is belt-and-braces
  // for anything thrown before it (an unset env read, say).
  if (input.smsConsent) {
    const { email, phone, fullName } = input;
    const crmPageId = clientPageId;
    await deferBestEffort("sms consent", async () => {
      try {
        await recordSmsConsent({
          email,
          phone,
          fullName,
          // Reuse the row the upsert above already resolved rather than
          // querying for it a second time. Undefined when that upsert failed
          // or the CRM isn't configured, and then this looks it up itself.
          ...(crmPageId ? { clientPageId: crmPageId } : {}),
        });
      } catch (err) {
        logger.warn(
          { err },
          "Failed to record SMS consent; the order is unaffected",
        );
      }
    });
  }

  // Best-effort emails; a mail failure must not fail the order. Because the
  // response is identical either way, they are handed off with `deferBestEffort`
  // rather than awaited inline: two sequential Resend round-trips were a large
  // part of this endpoint's 1.6-3.0s, all of it spent after the order was
  // already safely recorded in Notion. Where the platform offers no `waitUntil`
  // (local dev, tests) that helper awaits inline, so the emails are never traded
  // away for the latency — see lib/background.ts.
  //
  // The sender and inbox are resolved *here*, while the request's primed
  // settings snapshot is current, so only the network calls are deferred.
  const from = fromAddress("orders");
  const inbox = atelierInbox("orders");
  const confirmation = { ...orderConfirmationEmail(input, orderNumber), from };
  const notification = inbox
    ? { ...orderNotificationEmail(input, orderNumber, inbox), from }
    : null;

  await deferBestEffort("order confirmation emails", async () => {
    await sendEmailBestEffort(confirmation);
    if (notification) {
      await sendEmailBestEffort(notification);
    }
  });

  return { orderNumber };
}
