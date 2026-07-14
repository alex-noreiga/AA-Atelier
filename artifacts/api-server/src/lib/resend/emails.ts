// Pure email builders. Each maps an already-validated domain input to an
// `EmailMessage` (`to`/`subject`/`html`/`text`); the client supplies `from`.
// Kept separate from the transport (`send.ts`) and the client (`client.ts`) so
// the copy and field mapping are independently unit-testable — the same split
// as the Notion `*.blocks.ts` property builders.
//
// Voice: the site's minimal, warm, editorial-serif tone. Plain inline HTML (no
// template engine, no new dependency) plus a plaintext twin for every message.

import type { CreateOrderInput } from "../notion/schema.js";
import type { CreateContactInput } from "../notion/contact.blocks.js";
import type { CreateNotifyInput } from "../notion/notify.blocks.js";
import type { CreateMeasurementChangeInput } from "../notion/measurement-change.blocks.js";
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

/** A plain internal shell — no customer-facing sign-off. */
function internalLayout(heading: string, bodyHtml: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#faf8f5;">
    <div style="max-width:560px;margin:0 auto;padding:32px 28px;font-family:Georgia,'Times New Roman',serif;color:#2b2622;line-height:1.6;">
      <p style="font-size:13px;letter-spacing:0.18em;text-transform:uppercase;color:#8a7f74;margin:0 0 20px;">${ATELIER_NAME} · new submission</p>
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
