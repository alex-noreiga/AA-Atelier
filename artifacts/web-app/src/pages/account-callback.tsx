import { useEffect } from "react";
import { useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { Seo } from "@/components/seo";
import { ROUTE_SEO } from "@/lib/seo-routes";
import { useAuth } from "@/lib/auth-context";
import { takePostSignInPath } from "@/lib/post-signin";

/**
 * Landing page for the Supabase Auth redirect (Google OAuth, magic link, and
 * email-verification links). supabase-js parses the token out of the URL on load
 * (`detectSessionInUrl`), which surfaces here as a resolved session; we then
 * forward to wherever the sign-in started (the studio dashboard, say) or the
 * customer dashboard by default — or back to sign-in with an error if it didn't
 * take. (Password-reset links use their own `/account/reset` redirect target.)
 */
export default function AccountCallback() {
  const { session, loading } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (loading) return;
    const next = takePostSignInPath() ?? "/account";
    navigate(session ? next : "/account/login?error=expired", {
      replace: true,
    });
  }, [loading, session, navigate]);

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
