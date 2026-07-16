import { LegalPage, LegalSection } from "@/components/legal-page";
import { ROUTE_SEO } from "@/lib/seo-routes";
import { CONTACT_EMAIL } from "@/lib/contact-info";

// NOTE: Starter terms grounded in the app's actual flows (custom orders,
// deposits, appointments, shop purchases). NOT legal advice — have it reviewed
// before relying on it, and bump the "last updated" date when it changes.

export default function Terms() {
  return (
    <LegalPage
      seo={ROUTE_SEO["/terms"]}
      heading="Terms of Service"
      intro="These terms govern your use of the A.A Atelier website and the orders, appointments, and purchases you make through it."
      lastUpdated="July 16, 2026"
    >
      <LegalSection title="Using this site">
        <p>
          By placing an order, booking an appointment, or making a purchase, you
          agree to these terms. Please provide accurate information — including
          your measurements and design notes — so we can craft your piece
          correctly.
        </p>
      </LegalSection>

      <LegalSection title="Custom orders and quotes">
        <p>
          Custom commissions are quoted individually. A quote becomes an order
          once you confirm it and pay any required deposit. Because each garment
          is made to your measurements and specifications, we begin sourcing
          materials and cutting once work is underway.
        </p>
      </LegalSection>

      <LegalSection title="Deposits and payment">
        <p>
          Custom orders may require a non-refundable deposit before work begins;
          the deposit is applied to your final balance. Shop purchases are paid
          in full at checkout. All payments are processed securely through
          Stripe, and prices are shown in U.S. dollars. Applicable sales tax and
          shipping are calculated at checkout.
        </p>
      </LegalSection>

      <LegalSection title="Appointments">
        <p>
          Appointments are booked for a specific time and staff member. If you
          need to reschedule or cancel, please let us know as early as you can so
          we can offer the slot to another client.
        </p>
      </LegalSection>

      <LegalSection title="Returns">
        <p>
          Custom, made-to-measure garments are final sale. Ready-to-wear shop
          items may be eligible for return under the conditions in our{" "}
          <a href="/shipping-returns" className="text-primary hover:underline">
            Shipping &amp; Returns
          </a>{" "}
          policy.
        </p>
      </LegalSection>

      <LegalSection title="Intellectual property">
        <p>
          The content, designs, and images on this site are the property of A.A
          Atelier and may not be reproduced without permission.
        </p>
      </LegalSection>

      <LegalSection title="Limitation of liability">
        <p>
          We take great care with every commission, but to the extent permitted
          by law, A.A Atelier is not liable for indirect or incidental damages
          arising from your use of this site or our products.
        </p>
      </LegalSection>

      <LegalSection title="Contact us">
        <p>
          Questions about these terms? Reach us at{" "}
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
