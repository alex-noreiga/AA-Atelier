// Pure email builders. Each maps an already-validated domain input to an
// `EmailMessage` (`to`/`subject`/`html`/`text`); the client supplies `from`.
// Kept separate from the transport (`send.ts`) and the client (`client.ts`) so
// the copy and field mapping are independently unit-testable — the same split
// as the Notion `*.blocks.ts` property builders.
//
// Voice: the site's minimal, warm, editorial-serif tone. Plain inline HTML (no
// template engine, no new dependency) plus a plaintext twin for every message.

import type { CreateOrderInput } from "../notion/orders.schema.js";
import type { CreateContactInput } from "../notion/contact.blocks.js";
import type { CreateNotifyInput } from "../notion/notify.blocks.js";
import type { CreateMeasurementChangeInput } from "../notion/measurement-change.blocks.js";
import type { ConfigDriftFinding } from "../config-audit.js";
import type { EmailMessage } from "./client.js";

const ATELIER_NAME = "A.A Atelier";

/** Wrap body copy in a minimal, serif-leaning HTML shell shared by all emails. */
function layout(heading: string, bodyHtml: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#faf8f5;">
    <div style="max-width:520px;margin:0 auto;padding:40px 28px;font-family:Georgia,'Times New Roman',serif;color:#2b2622;line-height:1.6;">
      <p style="font-size:13px;letter-spacing:0.18em;text-transform:uppercase;color:#8a7f74;margin:0 0 28px;">${ATELIER_NAME}</p>
      <h1 style="font-size:22px;font-weight:normal;margin:0 0 20px;">${heading}</h1>
      ${bodyHtml}
      <p style="font-size:13px;color:#8a7f74;margin:36px 0 0;border-top:1px solid #e7e0d8;padding-top:16px;">Thank you,<br/>The ${ATELIER_NAME} team</p>
    </div>
  </body>
</html>`;
}

/** Confirmation sent to the customer when a new custom order is submitted. */
export function orderConfirmationEmail(
  input: CreateOrderInput,
  orderNumber: string,
): EmailMessage {
  const firstName = input.fullName.trim().split(/\s+/)[0] || "there";

  const html = layout(
    "Your order is in our hands",
    `<p>Hi ${firstName},</p>
     <p>Thank you for trusting us with your custom piece. We've received your order and
        our atelier will begin the journey from measurements to finished garment.</p>
     <p>Your order number is <strong>${orderNumber}</strong>. Keep it handy — you can
        follow each stage of your garment's progress on our website using this number.</p>
     <p>We'll be in touch as your piece takes shape.</p>`,
  );

  const text = [
    `Hi ${firstName},`,
    ``,
    `Thank you for trusting us with your custom piece. We've received your order and`,
    `our atelier will begin the journey from measurements to finished garment.`,
    ``,
    `Your order number is ${orderNumber}. Keep it handy — you can follow each stage`,
    `of your garment's progress on our website using this number.`,
    ``,
    `We'll be in touch as your piece takes shape.`,
    ``,
    `Thank you,`,
    `The ${ATELIER_NAME} team`,
  ].join("\n");

  return {
    to: input.email,
    subject: `We've received your order (${orderNumber})`,
    html,
    text,
  };
}

/** Acknowledgement sent to the customer after a contact-form submission. */
export function contactAckEmail(input: CreateContactInput): EmailMessage {
  const firstName = input.name.trim().split(/\s+/)[0] || "there";

  const html = layout(
    "Thank you for reaching out",
    `<p>Hi ${firstName},</p>
     <p>We've received your message and one of us will read it personally and reply
        soon. We appreciate you taking the time to write.</p>`,
  );

  const text = [
    `Hi ${firstName},`,
    ``,
    `We've received your message and one of us will read it personally and reply`,
    `soon. We appreciate you taking the time to write.`,
    ``,
    `Thank you,`,
    `The ${ATELIER_NAME} team`,
  ].join("\n");

  return {
    to: input.email,
    subject: `We received your message`,
    html,
    text,
  };
}

/** Confirmation that a back-in-stock request has been filed for the customer. */
export function backInStockConfirmationEmail(
  input: CreateNotifyInput,
): EmailMessage {
  // Mirror the subject phrasing used for the Notion inbox row in notify.blocks.ts.
  const piece = input.size ? `${input.item} — ${input.size}` : input.item;

  const html = layout(
    "We'll let you know",
    `<p>Hi there,</p>
     <p>Thank you for your interest in <strong>${piece}</strong>. We've noted your
        request, and we'll email you as soon as it's back in stock.</p>`,
  );

  const text = [
    `Hi there,`,
    ``,
    `Thank you for your interest in ${piece}. We've noted your request, and we'll`,
    `email you as soon as it's back in stock.`,
    ``,
    `Thank you,`,
    `The ${ATELIER_NAME} team`,
  ].join("\n");

  return {
    to: input.email,
    subject: `You're on the list for ${input.item}`,
    html,
    text,
  };
}

// ---------------------------------------------------------------------------
// Atelier-facing notifications
//
// These go to the atelier's own inbox (`ATELIER_INBOX_EMAIL`) when a customer
// submits something, so the team gets a nudge instead of only finding it in
// Notion. `to` is the atelier inbox (passed in — it's config, not input) and
// `replyTo` is the customer, so hitting reply answers them directly. Free-text
// customer values are HTML-escaped since they land in an HTML body.
// ---------------------------------------------------------------------------

/** Escape customer-provided text before interpolating it into an HTML body. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A plain internal shell — no customer-facing sign-off. The tagline defaults to
 * "new submission" (most internal mail is a new form), overridable for alerts. */
function internalLayout(
  heading: string,
  bodyHtml: string,
  tagline = "new submission",
): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#faf8f5;">
    <div style="max-width:560px;margin:0 auto;padding:32px 28px;font-family:Georgia,'Times New Roman',serif;color:#2b2622;line-height:1.6;">
      <p style="font-size:13px;letter-spacing:0.18em;text-transform:uppercase;color:#8a7f74;margin:0 0 20px;">${ATELIER_NAME} · ${escapeHtml(tagline)}</p>
      <h1 style="font-size:20px;font-weight:normal;margin:0 0 16px;">${heading}</h1>
      ${bodyHtml}
    </div>
  </body>
</html>`;
}

/** A label/value line; entries with an empty value are dropped by the callers. */
type Field = [label: string, value: string];

function renderRowsHtml(fields: Field[]): string {
  return fields
    .map(
      ([label, value]) =>
        `<p style="margin:0 0 10px;"><strong>${label}:</strong> ${escapeHtml(value)}</p>`,
    )
    .join("\n      ");
}

function renderRowsText(fields: Field[]): string {
  return fields.map(([label, value]) => `${label}: ${value}`).join("\n");
}

/** Notify the atelier of a new contact-form message. */
export function contactNotificationEmail(
  input: CreateContactInput,
  to: string,
): EmailMessage {
  const fields: Field[] = [
    ["Name", input.name],
    ["Email", input.email],
    ...(input.phone ? [["Phone", input.phone] as Field] : []),
    ["Message", input.message],
  ];

  return {
    to,
    replyTo: input.email,
    subject: `New contact message from ${input.name}`,
    html: internalLayout("New contact message", renderRowsHtml(fields)),
    text: renderRowsText(fields),
  };
}

/**
 * Alert the atelier that a website feature depends on a Notion option value that
 * no longer exists (a rename/removal that will silently break it). Sent
 * best-effort by the nightly config-drift check.
 */
export function configDriftNotificationEmail(
  findings: ConfigDriftFinding[],
  to: string,
): EmailMessage {
  const rowsHtml = findings
    .map(
      (finding) =>
        `<p style="margin:0 0 12px;"><strong>${escapeHtml(finding.label)}</strong><br/>` +
        `Missing from Notion: ${escapeHtml(finding.missing.join(", "))}</p>`,
    )
    .join("\n      ");
  const intro =
    `<p style="margin:0 0 16px;">A scheduled check found Notion options that a ` +
    `website feature relies on but that no longer exist — most likely an option ` +
    `was renamed or removed. Until it's restored, that feature quietly stops ` +
    `working (for example, garments losing their size chart).</p>`;
  const html = internalLayout(
    "Website config check — action needed",
    `${intro}\n      ${rowsHtml}`,
    "config check",
  );
  const text =
    "A scheduled check found Notion options a website feature relies on but " +
    "that no longer exist (likely renamed or removed):\n\n" +
    findings
      .map(
        (finding) =>
          `- ${finding.label}: missing ${finding.missing.join(", ")}`,
      )
      .join("\n") +
    "\n\nRestore the option name in Notion (or ask a developer to update the " +
    "matching setting).";
  return {
    to,
    subject:
      "A.A Atelier — a Notion option a website feature needs was renamed",
    html,
    text,
  };
}

/** Notify the atelier of a new custom order. */
export function orderNotificationEmail(
  input: CreateOrderInput,
  orderNumber: string,
  to: string,
): EmailMessage {
  const measurements =
    `waist ${input.waist}, bust ${input.bust}, hips ${input.hips}, ` +
    `height ${input.height}, girth ${input.bodyGirth} (${input.measurementUnit})`;

  const fields: Field[] = [
    ["Order number", orderNumber],
    ["Name", input.fullName],
    ["Email", input.email],
    ["Phone", input.phone],
    ["Preferred contact", input.preferredContact],
    ["Measurements", measurements],
    ...(input.neededBy
      ? [["Needed by", input.neededBy.toISOString().slice(0, 10)] as Field]
      : []),
    ...(input.description ? [["Notes", input.description] as Field] : []),
  ];

  return {
    to,
    replyTo: input.email,
    subject: `New order ${orderNumber} — ${input.fullName}`,
    html: internalLayout(`New order ${orderNumber}`, renderRowsHtml(fields)),
    text: renderRowsText(fields),
  };
}

/** Notify the atelier of a new back-in-stock request. */
export function backInStockNotificationEmail(
  input: CreateNotifyInput,
  to: string,
): EmailMessage {
  const fields: Field[] = [
    ["Item", input.item],
    ...(input.size ? [["Size", input.size] as Field] : []),
    ["Email", input.email],
  ];

  return {
    to,
    replyTo: input.email,
    subject: `Back-in-stock request — ${input.item}`,
    html: internalLayout("New back-in-stock request", renderRowsHtml(fields)),
    text: renderRowsText(fields),
  };
}

/** Confirmation that a measurement-change request has been filed for the customer. */
export function measurementChangeConfirmationEmail(
  input: CreateMeasurementChangeInput,
  orderNumber: string,
): EmailMessage {
  const detailHtml = input.measurementAppointment
    ? `<p>We'll be in touch to schedule a fitting or consultation to take your new measurements.</p>`
    : `<p>We've noted your updated measurements, and the atelier will review and apply them to your order.</p>`;

  const detailText = input.measurementAppointment
    ? `We'll be in touch to schedule a fitting or consultation to take your new measurements.`
    : `We've noted your updated measurements, and the atelier will review and apply them to your order.`;

  const html = layout(
    "We've received your measurement change",
    `<p>Hi there,</p>
     <p>Thank you — we've received your request to update the measurements on order
        <strong>${orderNumber}</strong>.</p>
     ${detailHtml}`,
  );

  const text = [
    `Hi there,`,
    ``,
    `Thank you — we've received your request to update the measurements on order ${orderNumber}.`,
    ``,
    detailText,
    ``,
    `Thank you,`,
    `The ${ATELIER_NAME} team`,
  ].join("\n");

  return {
    to: input.email,
    subject: `We've received your measurement change (${orderNumber})`,
    html,
    text,
  };
}

// ---------------------------------------------------------------------------
// Appointments
// ---------------------------------------------------------------------------

/** The already-formatted details of a booked appointment, for email copy. */
export interface AppointmentEmailDetails {
  customerName: string;
  email: string;
  phone?: string;
  typeName: string;
  staff: string;
  locationLabel: string;
  /** Human, timezone-labelled start time, e.g. "Monday, July 20 at 10:00 AM EDT". */
  when: string;
  confirmationCode: string;
  notes?: string;
  /** The Google Meet link for a virtual appointment, when one was created. */
  meetingUrl?: string;
}

/** Confirmation sent to the customer when they book an appointment. */
export function appointmentConfirmationEmail(
  details: AppointmentEmailDetails,
): EmailMessage {
  const firstName = details.customerName.trim().split(/\s+/)[0] || "there";

  const meetHtml = details.meetingUrl
    ? `<p><strong>Join link:</strong> <a href="${details.meetingUrl}">${details.meetingUrl}</a></p>`
    : "";

  const html = layout(
    "Your appointment is booked",
    `<p>Hi ${firstName},</p>
     <p>You're booked for a <strong>${details.typeName}</strong> with
        <strong>${details.staff}</strong>.</p>
     <p><strong>When:</strong> ${details.when}<br/>
        <strong>Where:</strong> ${details.locationLabel}</p>
     ${meetHtml}
     <p>A calendar invitation is on its way to your inbox. Your confirmation code
        is <strong>${details.confirmationCode}</strong>. If you need to change or
        cancel, just reply to this email and we'll take care of it.</p>
     <p>We look forward to seeing you.</p>`,
  );

  const text = [
    `Hi ${firstName},`,
    ``,
    `You're booked for a ${details.typeName} with ${details.staff}.`,
    ``,
    `When: ${details.when}`,
    `Where: ${details.locationLabel}`,
    ...(details.meetingUrl ? [`Join link: ${details.meetingUrl}`] : []),
    ``,
    `A calendar invitation is on its way to your inbox. Your confirmation code is`,
    `${details.confirmationCode}. If you need to change or cancel, just reply to`,
    `this email and we'll take care of it.`,
    ``,
    `We look forward to seeing you.`,
    ``,
    `Thank you,`,
    `The ${ATELIER_NAME} team`,
  ].join("\n");

  return {
    to: details.email,
    subject: `Your ${details.typeName} is booked (${details.confirmationCode})`,
    html,
    text,
  };
}

/** Notify the atelier of a newly booked appointment. */
export function appointmentNotificationEmail(
  details: AppointmentEmailDetails,
  to: string,
): EmailMessage {
  const fields: Field[] = [
    ["Type", details.typeName],
    ["Staff", details.staff],
    ["When", details.when],
    ["Location", details.locationLabel],
    ["Name", details.customerName],
    ["Email", details.email],
    ...(details.phone ? [["Phone", details.phone] as Field] : []),
    ["Confirmation", details.confirmationCode],
    ...(details.notes ? [["Notes", details.notes] as Field] : []),
  ];

  return {
    to,
    replyTo: details.email,
    subject: `New ${details.typeName} — ${details.customerName} (${details.when})`,
    html: internalLayout("New appointment booked", renderRowsHtml(fields)),
    text: renderRowsText(fields),
  };
}

/** Notify the atelier of a new measurement-change request. */
export function measurementChangeNotificationEmail(
  input: CreateMeasurementChangeInput,
  orderNumber: string,
  to: string,
): EmailMessage {
  const measurementField: Field = input.measurementAppointment
    ? ["Requested", "Re-measurement at a fitting/consultation"]
    : [
        "Measurements",
        `waist ${input.waist}, bust ${input.bust}, hips ${input.hips}, ` +
          `height ${input.height}, girth ${input.bodyGirth} (${input.measurementUnit})`,
      ];

  const fields: Field[] = [
    ["Order number", orderNumber],
    ["Email", input.email],
    measurementField,
    ...(input.note ? [["Note", input.note] as Field] : []),
  ];

  return {
    to,
    replyTo: input.email,
    subject: `Measurement change request — order ${orderNumber}`,
    html: internalLayout("Measurement change request", renderRowsHtml(fields)),
    text: renderRowsText(fields),
  };
}

// ---------------------------------------------------------------------------
// Shop orders (paid Stripe checkout)
//
// Unlike a custom order, a shop-cart order has no `CreateXInput` domain type —
// its source is the paid Stripe session. The caller (checkout.service) converts
// that session into this already-formatted, Stripe-agnostic struct (all money in
// dollars) so these builders stay pure and independently testable, the same
// precedent as `AppointmentEmailDetails`.
// ---------------------------------------------------------------------------

/** One purchased line on a shop order; `amount` is the line total in dollars. */
export interface ShopOrderEmailLine {
  description: string;
  quantity: number;
  amount: number;
}

/** The already-formatted details of a paid shop order. Money is in dollars. */
export interface ShopOrderEmailDetails {
  email: string;
  customerName?: string;
  /** The human-readable order number (e.g. "SHP-…") the customer tracks by. */
  orderNumber?: string;
  lineItems: ShopOrderEmailLine[];
  subtotal: number;
  shipping: number;
  tax: number;
  total: number;
  /** One-line shipping address, when Stripe collected one. */
  shippingAddress?: string;
}

/** Format a dollar amount as "$X.XX". */
function formatUsd(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/** Confirmation sent to the customer when a shop-cart order is paid. */
export function shopOrderConfirmationEmail(
  details: ShopOrderEmailDetails,
): EmailMessage {
  const firstName = details.customerName?.trim().split(/\s+/)[0] || "there";

  const itemsHtml = details.lineItems
    .map(
      (item) =>
        `<tr>
           <td style="padding:6px 0;">${escapeHtml(`${item.quantity} × ${item.description}`)}</td>
           <td style="padding:6px 0;text-align:right;white-space:nowrap;">${formatUsd(item.amount)}</td>
         </tr>`,
    )
    .join("\n         ");

  // Subtotal always; shipping/tax only when charged (mirrors the on-site receipt).
  const totals: [string, number][] = [
    ["Subtotal", details.subtotal],
    ...(details.shipping > 0
      ? [["Shipping", details.shipping] as [string, number]]
      : []),
    ...(details.tax > 0 ? [["Tax", details.tax] as [string, number]] : []),
  ];
  const totalsHtml = totals
    .map(
      ([label, amount]) =>
        `<tr>
           <td style="padding:2px 0;color:#8a7f74;">${label}</td>
           <td style="padding:2px 0;text-align:right;color:#8a7f74;">${formatUsd(amount)}</td>
         </tr>`,
    )
    .join("\n         ");

  const receiptHtml = `
     <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:15px;">
       ${itemsHtml}
       <tr><td colspan="2" style="border-top:1px solid #e7e0d8;padding-top:8px;"></td></tr>
       ${totalsHtml}
       <tr>
         <td style="padding:8px 0 0;font-weight:bold;">Total</td>
         <td style="padding:8px 0 0;text-align:right;font-weight:bold;">${formatUsd(details.total)}</td>
       </tr>
     </table>`;

  const shippingHtml = details.shippingAddress
    ? `<p><strong>Shipping to:</strong> ${escapeHtml(details.shippingAddress)}</p>`
    : "";

  // Order number, shown prominently so the customer can track their order.
  const orderNumberHtml = details.orderNumber
    ? `<p style="margin:16px 0;">Your order number is
         <strong style="letter-spacing:0.04em;">${escapeHtml(details.orderNumber)}</strong>.
         Keep it handy to track your order's progress.</p>`
    : "";

  const html = layout(
    "Thank you for your order",
    `<p>Hi ${firstName},</p>
     <p>Your payment went through and your order is confirmed. Here's what you bought:</p>
     ${receiptHtml}
     ${orderNumberHtml}
     ${shippingHtml}
     <p>We'll carefully prepare your pieces and be in touch with shipping details soon.</p>`,
  );

  const itemsText = details.lineItems.map(
    (item) =>
      `${item.quantity} × ${item.description} — ${formatUsd(item.amount)}`,
  );
  const totalsText = [
    ...totals.map(([label, amount]) => `${label}: ${formatUsd(amount)}`),
    `Total: ${formatUsd(details.total)}`,
  ];

  const text = [
    `Hi ${firstName},`,
    ``,
    `Your payment went through and your order is confirmed. Here's what you bought:`,
    ``,
    ...itemsText,
    ``,
    ...totalsText,
    ...(details.orderNumber
      ? [
          ``,
          `Your order number is ${details.orderNumber}. Keep it handy to track your order's progress.`,
        ]
      : []),
    ...(details.shippingAddress
      ? [``, `Shipping to: ${details.shippingAddress}`]
      : []),
    ``,
    `We'll carefully prepare your pieces and be in touch with shipping details soon.`,
    ``,
    `Thank you,`,
    `The ${ATELIER_NAME} team`,
  ].join("\n");

  return {
    to: details.email,
    subject: `Your ${ATELIER_NAME} order is confirmed`,
    html,
    text,
  };
}

// ---------------------------------------------------------------------------
// System alerts
//
// Not customer- or submission-facing: an internal heads-up sent to the atelier
// when the app hits an error-level condition it would otherwise only log (an
// unhandled 500, or a best-effort side effect that failed silently). Built here,
// with the other atelier-facing builders, so the copy stays independently
// testable; sent by `services/alert.service.ts`. See CLAUDE.md.
// ---------------------------------------------------------------------------

/** A plain internal shell for a system alert (distinct eyebrow from submissions). */
function alertLayout(heading: string, bodyHtml: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#faf8f5;">
    <div style="max-width:560px;margin:0 auto;padding:32px 28px;font-family:Georgia,'Times New Roman',serif;color:#2b2622;line-height:1.6;">
      <p style="font-size:13px;letter-spacing:0.18em;text-transform:uppercase;color:#a15c4a;margin:0 0 20px;">${ATELIER_NAME} · system alert</p>
      <h1 style="font-size:20px;font-weight:normal;margin:0 0 16px;">${heading}</h1>
      ${bodyHtml}
    </div>
  </body>
</html>`;
}

/** The already-extracted details of a production error, for the alert email. */
export interface ErrorAlertDetails {
  /** The log message the error was reported with (e.g. "Unhandled error"). */
  message: string;
  errorType?: string;
  errorMessage?: string;
  /** A (truncated) stack trace, when the error carried one. */
  stack?: string;
  method?: string;
  path?: string;
  requestId?: string;
  statusCode?: number;
  /** Deploy environment, e.g. "production" (VERCEL_ENV) or the NODE_ENV. */
  environment?: string;
  /** ISO timestamp of when the alert was raised. */
  timestamp: string;
}

/** Internal alert to the atelier that the app hit a production error. */
export function errorAlertEmail(
  details: ErrorAlertDetails,
  to: string,
): EmailMessage {
  const fields: Field[] = [
    ["What", details.message],
    ...(details.errorType ? [["Error", details.errorType] as Field] : []),
    ...(details.errorMessage
      ? [["Detail", details.errorMessage] as Field]
      : []),
    ...(typeof details.statusCode === "number"
      ? [["Status", String(details.statusCode)] as Field]
      : []),
    ...(details.method && details.path
      ? [["Request", `${details.method} ${details.path}`] as Field]
      : []),
    ...(details.requestId ? [["Request ID", details.requestId] as Field] : []),
    ...(details.environment
      ? [["Environment", details.environment] as Field]
      : []),
    ["When", details.timestamp],
  ];

  const stackHtml = details.stack
    ? `<pre style="margin:16px 0 0;padding:12px;background:#f1ece5;border:1px solid #e7e0d8;border-radius:4px;font-family:'SFMono-Regular',Consolas,monospace;font-size:12px;line-height:1.5;white-space:pre-wrap;overflow-x:auto;">${escapeHtml(details.stack)}</pre>`
    : "";
  const stackText = details.stack ? `\n\nStack:\n${details.stack}` : "";

  return {
    to,
    subject: `[${ATELIER_NAME}] Error: ${details.message}`,
    html: alertLayout("Production error", renderRowsHtml(fields) + stackHtml),
    text: renderRowsText(fields) + stackText,
  };
}

/** Notify the atelier of a newly paid shop order. */
export function shopOrderNotificationEmail(
  details: ShopOrderEmailDetails,
  to: string,
): EmailMessage {
  const items = details.lineItems
    .map(
      (item) =>
        `${item.quantity} × ${item.description} — ${formatUsd(item.amount)}`,
    )
    .join("; ");

  const who = details.customerName || details.email;
  const fields: Field[] = [
    ...(details.orderNumber
      ? [["Order number", details.orderNumber] as Field]
      : []),
    ...(details.customerName ? [["Name", details.customerName] as Field] : []),
    ["Email", details.email],
    ["Items", items],
    ...(details.shippingAddress
      ? [["Shipping to", details.shippingAddress] as Field]
      : []),
    ["Total", formatUsd(details.total)],
  ];

  return {
    to,
    replyTo: details.email,
    subject: `New shop order — ${who} (${formatUsd(details.total)})`,
    html: internalLayout("New shop order", renderRowsHtml(fields)),
    text: renderRowsText(fields),
  };
}
