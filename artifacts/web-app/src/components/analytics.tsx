import { Analytics } from "@vercel/analytics/react";
import { useConsent } from "@/lib/consent";

// Consent-gated web analytics. Vercel Web Analytics is privacy-friendly
// (cookieless, no cross-site tracking) and needs no backend or data model of
// our own — it's collected by the existing Vercel deployment. We still gate it
// behind explicit opt-in via the cookie-consent banner, so the studio stays
// compliant and the gate is already in place if analytics ever moves to a
// cookie-based provider.
//
// Rendering <Analytics /> injects Vercel's insights script; withholding it
// until consent is "granted" means no analytics request is made otherwise.
export default function ConsentedAnalytics() {
  const { status } = useConsent();
  if (status !== "granted") return null;
  return <Analytics />;
}
