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
import { measurementsLocked } from "./measurement-lock.js";
import { getIntakeStatus } from "./capacity.service.js";
import { closedMessage } from "./capacity.js";
import { getInvoicePaymentInfo } from "./invoice.service.js";
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

  const { pageId, invoicePageId, ...rest } = order;
  return {
    ...rest,
    stages,
    measurementsLocked: locked,
    ...(deposits.length ? { deposits } : {}),
    ...(invoice ? { invoice } : {}),
    ...(milestones.length ? { milestones } : {}),
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
 * The seasonal-capacity gate — the server's half of `GET /capacity`.
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
  if (input.referralCode) {
    try {
      await captureReferralOnOrder({
        referralCode: input.referralCode,
        email: input.email,
      });
    } catch (err) {
      logger.warn(
        { err },
        "Failed to capture referral on order; the order is unaffected",
      );
    }
  }

  // Best-effort emails; a mail failure must not fail the order.
  const from = fromAddress("orders");
  await sendEmailBestEffort({
    ...orderConfirmationEmail(input, orderNumber),
    from,
  });
  const inbox = atelierInbox("orders");
  if (inbox) {
    await sendEmailBestEffort({
      ...orderNotificationEmail(input, orderNumber, inbox),
      from,
    });
  }
  return { orderNumber };
}
