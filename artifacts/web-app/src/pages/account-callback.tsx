import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { Seo } from "@/components/seo";
import { ROUTE_SEO } from "@/lib/seo-routes";
import { useAuth } from "@/lib/auth-context";
import { parseAuthCallbackError } from "@/lib/auth-errors";

/**
 * Landing page for the Supabase Auth redirect (Google OAuth, magic link, and
 * email-verification links). supabase-js parses the token out of the URL on load
 * (`detectSessionInUrl`), which surfaces here as a resolved session; we then
 * forward to the dashboard — or back to sign-in with the reason it didn't take.
 * (Password-reset links use their own `/account/reset` redirect target.)
 *
 * When Supabase turns a sign-in away it says why in the redirect URL, so we
 * carry that reason through to the sign-in page instead of assuming an expired
 * link. `expired` stays the fallback for the one case with no stated reason:
 * the page loaded, no error came back, and still no session arrived.
 */
export default function AccountCallback() {
  const { session, loading } = useAuth();
  const [, navigate] = useLocation();

  // Read during render, not in an effect — supabase-js strips the auth params
  // off the URL once it has processed them.
  const [callbackError] = useState(() =>
    typeof window === "undefined"
      ? null
      : parseAuthCallbackError(window.location.search, window.location.hash),
  );

  useEffect(() => {
    if (!callbackError) return;
    // The full detail, including Supabase's description, for whoever is
    // debugging. The page itself shows the customer-facing version.
    console.error("Sign-in callback failed", callbackError);
  }, [callbackError]);

  useEffect(() => {
    // A stated error settles it — no need to wait on the session lookup.
    if (callbackError) {
      navigate(
        `/account/login?error=${encodeURIComponent(callbackError.code)}`,
        {
          replace: true,
        },
      );
      return;
    }
    if (loading) return;
    navigate(session ? "/account" : "/account/login?error=expired", {
      replace: true,
    });
  }, [loading, session, callbackError, navigate]);

  return (
    <PageShell>
      <Seo {...ROUTE_SEO["/account/callback"]} />
      <div
        className="flex flex-col items-center justify-center gap-4 py-24 text-muted-foreground"
        data-testid="account-callback"
      >
        <Loader2
          className="w-8 h-8 animate-spin text-primary"
          strokeWidth={1}
        />
        <p className="font-light">Signing you in…</p>
      </div>
    </PageShell>
  );
}
