import { LegalPage, LegalSection } from "@/components/legal-page";
import { ROUTE_SEO } from "@/lib/seo-routes";
import { CONTACT_EMAIL } from "@/lib/contact-info";

// NOTE: Starter shipping/returns copy grounded in the app's flows (Stripe
// shipping rates, custom vs. ready-to-wear). NOT legal advice — have it reviewed
// before relying on it, and bump the "last updated" date when it changes.

export default function ShippingReturns() {
  return (
    <LegalPage
      seo={ROUTE_SEO["/shipping-returns"]}
      heading="Shipping & Returns"
      intro="How and when your order ships, and what can and cannot be returned."
      lastUpdated="July 16, 2026"
    >
      <LegalSection title="Processing times">
        <p>
          Ready-to-wear shop items typically ship within a few business days of
          your order. Custom commissions are made to order — your timeline is
          agreed when you place the order and depends on the design and our
          current queue.
        </p>
      </LegalSection>

      <LegalSection title="Shipping">
        <p>
          Shipping options and rates are shown at checkout and calculated from
          your address. Once your order ships, delivery times depend on the
          carrier and destination. We are not responsible for carrier delays
          once a package has left the atelier.
        </p>
      </LegalSection>

      <LegalSection title="Custom orders are final sale">
        <p>
          Because custom, made-to-measure garments are crafted specifically for
          you, they cannot be returned or exchanged. We work closely with you —
          through measurements, notes, and fittings where offered — to get it
          right. If something isn't as agreed when your piece arrives, contact
          us right away and we'll make it right.
        </p>
      </LegalSection>

      <LegalSection title="Ready-to-wear returns">
        <p>
          Unworn ready-to-wear items with tags attached may be returned within
          30 days of delivery for a refund of the item price. To start a return,
          email us with your order number. Return shipping is the customer's
          responsibility unless the item arrived damaged or incorrect.
        </p>
      </LegalSection>

      <LegalSection title="Damaged or incorrect items">
        <p>
          If your order arrives damaged or we sent the wrong item, email us
          within 7 days of delivery with a photo and your order number and we'll
          arrange a replacement or refund.
        </p>
      </LegalSection>

      <LegalSection title="Contact us">
        <p>
          Questions about shipping or a return? Reach us at{" "}
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="text-primary hover:underline"
          >
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
