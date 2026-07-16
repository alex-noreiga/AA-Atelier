import { LegalPage, LegalSection } from "@/components/legal-page";
import { ROUTE_SEO } from "@/lib/seo-routes";
import { CONTACT_EMAIL } from "@/lib/contact-info";

// NOTE: This is starter policy copy grounded in what the app actually does
// (Stripe payments, Notion/Resend/Google as processors, measurement + CRM data).
// It is NOT legal advice — the atelier should have it reviewed before relying on
// it, and update the "last updated" date when it changes.

export default function Privacy() {
  return (
    <LegalPage
      seo={ROUTE_SEO["/privacy"]}
      heading="Privacy Policy"
      intro="This policy explains what personal information A.A Atelier collects, how we use it, and the choices you have."
      lastUpdated="July 16, 2026"
    >
      <LegalSection title="Information we collect">
        <p>
          When you place a custom order, request a quote, book an appointment, or
          contact us, we collect the details you provide — your name, email
          address, phone number, body measurements, and any notes about your
          design. When you buy from our shop, our payment processor collects your
          shipping address and payment details on our behalf.
        </p>
        <p>
          We do not knowingly collect information from children, and we ask that
          a parent or guardian submit orders and measurements on behalf of a
          minor.
        </p>
      </LegalSection>

      <LegalSection title="How we use your information">
        <p>
          We use your information to create and fulfil your order, communicate
          with you about your commission or purchase, schedule and confirm
          appointments, send order and enquiry confirmations, and improve our
          service. We do not sell your personal information.
        </p>
      </LegalSection>

      <LegalSection title="Service providers">
        <p>
          We rely on trusted third parties to run the atelier, and share only
          the information each needs to do its job:
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>
            <strong>Stripe</strong> processes payments and deposits. We never
            store your full card details on our own systems.
          </li>
          <li>
            <strong>Notion</strong> stores your order, enquiry, and client
            records so we can manage your commission.
          </li>
          <li>
            <strong>Resend</strong> delivers the confirmation and notification
            emails we send you.
          </li>
          <li>
            <strong>Google</strong> (Calendar and Sheets) powers appointment
            scheduling and booking.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Data retention">
        <p>
          We keep your information for as long as needed to fulfil your order and
          maintain our business records, after which we remove or anonymise it.
          You may ask us to update or delete your information at any time, subject
          to records we are required to keep.
        </p>
      </LegalSection>

      <LegalSection title="Your choices">
        <p>
          You can ask us what information we hold about you, correct it, or
          request its deletion. You can opt out of non-essential emails at any
          time. To make a request, email us at{" "}
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="text-primary hover:underline"
          >
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection title="Contact us">
        <p>
          Questions about this policy? Reach us at{" "}
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
