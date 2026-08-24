import { Link } from "wouter";
import { LegalPage, LegalSection } from "@/components/legal-page";
import { ROUTE_SEO } from "@/lib/seo-routes";
import { CONTACT_EMAIL } from "@/lib/contact-info";
import { Button } from "@/components/ui/button";
import { useConsent } from "@/lib/consent";

const CONSENT_LABEL: Record<string, string> = {
  granted: "Accepted, analytics is on",
  denied: "Declined, analytics is off",
  unset: "Not set yet",
};

// Lets a visitor revisit the analytics choice they made in the consent banner,
// as easily as they gave it. `reset()` clears the stored choice, which brings
// the banner back so they can decide again.
function ManageCookiePreferences() {
  const { status, reset } = useConsent();
  return (
    <div className="space-y-3">
      <p>
        Your current choice:{" "}
        <strong className="text-foreground">{CONSENT_LABEL[status]}</strong>.
      </p>
      <Button
        variant="outline"
        size="sm"
        onClick={reset}
        data-testid="manage-cookie-preferences"
      >
        Change cookie preferences
      </Button>
    </div>
  );
}

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
      lastUpdated="August 24, 2026"
    >
      <LegalSection title="Information we collect">
        <p>
          When you place a custom order, request a quote, book an appointment,
          or contact us, we collect the details you provide: your name, email
          address, phone number, body measurements, and any notes about your
          design. When you buy from our shop, our payment processor collects
          your shipping address and payment details on our behalf.
        </p>
        <p>
          We do not knowingly collect information from children, and we ask that
          a parent or guardian submit orders and measurements on behalf of a
          minor.
        </p>
      </LegalSection>

      <LegalSection title="How we use your information">
        <p>
          We use your information to create and fulfill your order, communicate
          with you about your commission or purchase, schedule and confirm
          appointments, send order and inquiry confirmations, and improve our
          service. We do not sell your personal information.
        </p>
      </LegalSection>

      <LegalSection title="Marketing emails">
        <p>
          If you join our mailing list, from the footer sign-up or by ticking
          the box when you place an order, we use your email address to send
          occasional studio news, such as new collections and behind-the-scenes
          notes. This is separate from the order, appointment, and inquiry
          confirmations above, and we only send it if you opt in.
        </p>
        <p>
          Every marketing email includes a one-click unsubscribe link, and you
          can opt out at any time. You will still receive the transactional
          emails about any active order or booking. Our email provider,
          <strong> Resend</strong>, manages the mailing list and honors
          unsubscribes on our behalf.
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
            <strong>Notion</strong> stores your order, inquiry, and client
            records so we can manage your commission.
          </li>
          <li>
            <strong>Resend</strong> delivers the confirmation and notification
            emails we send you, and manages our marketing mailing list
            (including unsubscribes).
          </li>
          <li>
            <strong>Google Calendar</strong> powers appointment scheduling and
            booking.
          </li>
          <li>
            <strong>Supabase</strong> holds the sign-in account behind the
            customer portal — your email address and, if you set one, your
            password.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Cookies and analytics">
        <p>
          We keep cookies to a minimum. A strictly necessary cookie keeps you
          signed in to your account when you use the customer portal. This is
          always on, because the site can't work without it.
        </p>
        <p>
          With your permission, we also use privacy-friendly web analytics to
          understand how our site is used: which pages are visited, and a few
          key actions such as adding an item to the cart, starting checkout, or
          placing an order, so we can see where visitors drop off and improve
          the experience. These measurements are not linked to your name or
          email. This analytics is cookieless, does not track you across other
          websites, and is only loaded once you accept it. You can accept or
          decline from the banner shown on your first visit, and change your
          mind at any time below.
        </p>
        <ManageCookiePreferences />
      </LegalSection>

      <LegalSection title="Data retention">
        <p>
          We keep your information for as long as needed to fulfill your order
          and maintain our business records, after which we remove or anonymise
          it. You may ask us to update or delete your information at any time,
          subject to records we are required to keep.
        </p>
      </LegalSection>

      <LegalSection title="Your choices">
        <p>
          You can ask us what information we hold about you, correct it, or
          request its deletion. If you have an account with us, both are in{" "}
          <Link href="/account" className="text-primary hover:underline">
            your account
          </Link>
          , under <strong>Your data</strong>: <strong>Download my data</strong>{" "}
          gives you a file containing everything we hold under your email
          address, straight away, and <strong>Request deletion</strong> takes
          you off our mailing list and sends your request to the studio for
          review.
        </p>
        <p>
          Deletion is reviewed by a person rather than done automatically,
          because some records — an invoice or a payment record, for instance —
          are business records we are required to keep for a period. We will
          tell you if that applies to anything of yours.
        </p>
        <p>
          You can opt out of marketing emails at any time using the unsubscribe
          link in any such email. If you would rather not use the account pages,
          or you have no account, email us at{" "}
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="text-primary hover:underline"
          >
            {CONTACT_EMAIL}
          </a>{" "}
          and we will handle your request the same way.
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
