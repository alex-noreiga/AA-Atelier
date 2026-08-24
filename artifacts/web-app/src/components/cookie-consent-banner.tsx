import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { useConsent } from "@/lib/consent";

// A small, client-side cookie-consent banner. It appears once — only while the
// visitor's analytics choice is still "unset" — and gates the non-essential
// analytics script (components/analytics.tsx) behind an explicit opt-in.
//
// Essential cookies (the account-portal session) are strictly necessary and
// aren't governed here, so there's no "reject essential" path; the two choices
// are Accept (opt in to analytics) and Decline (analytics stays off). A visitor
// can revisit the decision from the privacy page's "Manage cookie preferences"
// control.
//
// Editorial tokens mirror the footer/navbar: serif nothing-fancy, muted
// foreground, hairline border, background surface.
export default function CookieConsentBanner() {
  const { status, grant, deny } = useConsent();

  if (status !== "unset") return null;

  return (
    <div
      role="region"
      aria-label="Cookie consent"
      data-testid="cookie-consent-banner"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border/60 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-2xl text-sm font-light leading-relaxed text-muted-foreground">
          We use privacy-friendly analytics to understand how our site is used.
          These are optional. Essential cookies that keep the site working are
          always on. Read our{" "}
          <Link
            to="/privacy"
            className="text-primary underline-offset-4 hover:underline"
            data-testid="cookie-consent-privacy-link"
          >
            Privacy Policy
          </Link>
          .
        </p>
        <div className="flex shrink-0 items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={deny}
            data-testid="cookie-consent-decline"
          >
            Decline
          </Button>
          <Button size="sm" onClick={grant} data-testid="cookie-consent-accept">
            Accept
          </Button>
        </div>
      </div>
    </div>
  );
}
