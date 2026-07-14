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
import type { EmailMessage } from "./client.js";

const ATELIER_NAME = "AA-Atelier";

/** Wrap body copy in a minimal, serif-leaning HTML shell shared by all emails. */
function layout(heading: string, bodyHtml: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#faf8f5;">
    <div style="max-width:520px;margin:0 auto;padding:40px 28px;font-family:Georgia,'Times New Roman',serif;color:#2b2622;line-height:1.6;">
      <p style="font-size:13px;letter-spacing:0.18em;text-transform:uppercase;color:#8a7f74;margin:0 0 28px;">${ATELIER_NAME}</p>
      <h1 style="font-size:22px;font-weight:normal;margin:0 0 20px;">${heading}</h1>
      ${bodyHtml}
      <p style="font-size:13px;color:#8a7f74;margin:36px 0 0;border-top:1px solid #e7e0d8;padding-top:16px;">With care,<br/>The ${ATELIER_NAME} team</p>
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
    `<p>Dear ${firstName},</p>
     <p>Thank you for trusting us with your custom piece. We've received your order and
        our atelier will begin the journey from measurements to finished garment.</p>
     <p>Your order number is <strong>${orderNumber}</strong>. Keep it handy — you can
        follow each stage of your garment's progress on our website using this number.</p>
     <p>We'll be in touch as your piece takes shape.</p>`,
  );

  const text = [
    `Dear ${firstName},`,
    ``,
    `Thank you for trusting us with your custom piece. We've received your order and`,
    `our atelier will begin the journey from measurements to finished garment.`,
    ``,
    `Your order number is ${orderNumber}. Keep it handy — you can follow each stage`,
    `of your garment's progress on our website using this number.`,
    ``,
    `We'll be in touch as your piece takes shape.`,
    ``,
    `With care,`,
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
    `<p>Dear ${firstName},</p>
     <p>We've received your message and one of us will read it personally and reply
        soon. We appreciate you taking the time to write.</p>`,
  );

  const text = [
    `Dear ${firstName},`,
    ``,
    `We've received your message and one of us will read it personally and reply`,
    `soon. We appreciate you taking the time to write.`,
    ``,
    `With care,`,
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
    `<p>Hello,</p>
     <p>Thank you for your interest in <strong>${piece}</strong>. We've noted your
        request, and we'll email you as soon as it's back in stock.</p>`,
  );

  const text = [
    `Hello,`,
    ``,
    `Thank you for your interest in ${piece}. We've noted your request, and we'll`,
    `email you as soon as it's back in stock.`,
    ``,
    `With care,`,
    `The ${ATELIER_NAME} team`,
  ].join("\n");

  return {
    to: input.email,
    subject: `You're on the list for ${input.item}`,
    html,
    text,
  };
}
