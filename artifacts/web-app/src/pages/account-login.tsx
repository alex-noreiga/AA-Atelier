import { useState } from "react";
import { Redirect, useSearch } from "wouter";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/page-shell";
import { Seo } from "@/components/seo";
import { ROUTE_SEO } from "@/lib/seo-routes";
import { supabase, supabaseConfigured } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { Loader2, MailCheck } from "lucide-react";

/**
 * Sign-in for the customer account portal, on Supabase Auth. One editorial card
 * with two modes — Sign in and Create account — plus a passwordless magic-link
 * option, Google sign-in, and forgot-password. Password sign-in / Google
 * establish a session (supabase-js, in the browser), after which the signed-in
 * redirect below sends the customer to their dashboard. The email-based actions
 * (magic link, sign-up verification, password reset) instead show a "check your
 * inbox" confirmation, since they complete via a link in the email.
 */

type Mode = "signin" | "signup";
type Notice =
  | { kind: "magic"; email: string }
  | { kind: "verify"; email: string }
  | { kind: "reset"; email: string };

/** Where Supabase sends the customer back after an emailed link / OAuth. */
function callbackUrl(path = "/account/callback"): string {
  return `${window.location.origin}${path}`;
}

export default function AccountLogin() {
  const search = useSearch();
  const linkExpired = new URLSearchParams(search).get("error") === "expired";
  const { session, loading } = useAuth();

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  // Already signed in → straight to the dashboard.
  if (!loading && session) {
    return <Redirect to="/account" replace />;
  }

  if (!supabaseConfigured || !supabase) {
    return (
      <PageShell>
        <Seo {...ROUTE_SEO["/account/login"]} />
        <div className="w-full max-w-md z-10 mx-auto text-center">
          <h1 className="text-4xl font-serif text-foreground mb-4">
            Your Account
          </h1>
          <p
            className="text-muted-foreground font-light"
            data-testid="login-unavailable"
          >
            Sign-in is temporarily unavailable. Please check back soon, or look
            up an order by its number on the tracking page.
          </p>
        </div>
      </PageShell>
    );
  }
  const client = supabase;

  const trimmedEmail = email.trim();

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!trimmedEmail) return;
    if (mode === "signup" && password.length < 8) {
      setError("Please choose a password of at least 8 characters.");
      return;
    }
    if (!password) return;
    setBusy(true);
    if (mode === "signin") {
      const { error: signInError } = await client.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      });
      setBusy(false);
      if (signInError) {
        setError(signInError.message);
        return;
      }
      // On success the auth-state listener sets the session; the redirect above
      // then forwards to /account.
    } else {
      const { data, error: signUpError } = await client.auth.signUp({
        email: trimmedEmail,
        password,
        options: { emailRedirectTo: callbackUrl() },
      });
      setBusy(false);
      if (signUpError) {
        setError(signUpError.message);
        return;
      }
      // With email confirmation on, sign-up returns no session — the customer
      // must click the verification link first.
      if (!data.session) {
        setNotice({ kind: "verify", email: trimmedEmail });
      }
    }
  };

  const handleMagicLink = async () => {
    setError(null);
    if (!trimmedEmail) {
      setError("Enter your email first, then request a link.");
      return;
    }
    setBusy(true);
    const { error: otpError } = await client.auth.signInWithOtp({
      email: trimmedEmail,
      options: { emailRedirectTo: callbackUrl() },
    });
    setBusy(false);
    if (otpError) {
      setError(otpError.message);
      return;
    }
    setNotice({ kind: "magic", email: trimmedEmail });
  };

  const handleForgotPassword = async () => {
    setError(null);
    if (!trimmedEmail) {
      setError("Enter your email first, then request a reset.");
      return;
    }
    setBusy(true);
    const { error: resetError } = await client.auth.resetPasswordForEmail(
      trimmedEmail,
      { redirectTo: callbackUrl("/account/reset") },
    );
    setBusy(false);
    if (resetError) {
      setError(resetError.message);
      return;
    }
    setNotice({ kind: "reset", email: trimmedEmail });
  };

  const handleGoogle = async () => {
    setError(null);
    setBusy(true);
    const { error: oauthError } = await client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callbackUrl() },
    });
    // On success the browser is redirected away; only reached on error.
    if (oauthError) {
      setBusy(false);
      setError(oauthError.message);
    }
  };

  return (
    <PageShell>
      <Seo {...ROUTE_SEO["/account/login"]} />
      <div className="w-full max-w-md z-10 mx-auto animate-in fade-in zoom-in-95 duration-1000">
        <div className="text-center mb-10">
          <h1 className="text-4xl md:text-5xl font-serif text-foreground mb-4">
            Your Account
          </h1>
          <p className="text-muted-foreground font-light text-lg">
            Sign in to see your orders, invoices, and appointments in one place.
          </p>
        </div>

        {notice ? (
          <div
            className="text-center space-y-6 py-8 animate-in slide-in-from-bottom-4 fade-in duration-700"
            data-testid="login-notice"
          >
            <MailCheck
              className="w-10 h-10 text-primary mx-auto"
              strokeWidth={1}
            />
            <p className="text-foreground font-serif text-xl">
              Check your inbox
            </p>
            <p className="text-muted-foreground font-light">
              {notice.kind === "magic" && "Your sign-in link is on its way to "}
              {notice.kind === "verify" &&
                "Confirm your email to finish creating your account — we sent a link to "}
              {notice.kind === "reset" &&
                "If that email has an account, a password-reset link is on its way to "}
              <span className="text-foreground break-all">{notice.email}</span>.
            </p>
            <Button
              variant="outline"
              onClick={() => {
                setNotice(null);
                setPassword("");
              }}
              className="border-primary/20 text-primary hover:bg-primary/10 rounded-full px-6"
              data-testid="button-notice-back"
            >
              Back to sign in
            </Button>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Mode toggle */}
            <div
              className="flex justify-center gap-1 text-xs tracking-widest uppercase"
              data-testid="mode-toggle"
            >
              <button
                type="button"
                onClick={() => {
                  setMode("signin");
                  setError(null);
                }}
                className={`px-4 py-2 rounded-full transition-colors ${
                  mode === "signin"
                    ? "text-primary"
                    : "text-muted-foreground/60 hover:text-muted-foreground"
                }`}
                data-testid="tab-signin"
              >
                Sign in
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("signup");
                  setError(null);
                }}
                className={`px-4 py-2 rounded-full transition-colors ${
                  mode === "signup"
                    ? "text-primary"
                    : "text-muted-foreground/60 hover:text-muted-foreground"
                }`}
                data-testid="tab-signup"
              >
                Create account
              </button>
            </div>

            {linkExpired && (
              <p
                className="text-center text-sm text-destructive font-light"
                data-testid="login-expired"
              >
                That sign-in link has expired or already been used. Sign in
                again below.
              </p>
            )}

            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              <Input
                type="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full"
                data-testid="input-email"
              />
              <Input
                type="password"
                required
                autoComplete={
                  mode === "signup" ? "new-password" : "current-password"
                }
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full"
                data-testid="input-password"
              />

              {error && (
                <p
                  className="text-center text-sm text-destructive font-light"
                  data-testid="login-error"
                >
                  {error}
                </p>
              )}

              <Button
                type="submit"
                disabled={busy || !email.trim() || !password}
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90 py-6 rounded-full tracking-widest uppercase text-xs"
                data-testid="button-submit"
              >
                {busy ? (
                  <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.5} />
                ) : mode === "signin" ? (
                  "Sign in"
                ) : (
                  "Create account"
                )}
              </Button>
            </form>

            {mode === "signin" && (
              <div className="flex justify-between text-xs tracking-wide">
                <button
                  type="button"
                  onClick={handleMagicLink}
                  disabled={busy}
                  className="text-muted-foreground hover:text-primary transition-colors"
                  data-testid="button-magic-link"
                >
                  Email me a link instead
                </button>
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  disabled={busy}
                  className="text-muted-foreground hover:text-primary transition-colors"
                  data-testid="button-forgot"
                >
                  Forgot password?
                </button>
              </div>
            )}

            <div className="flex items-center gap-4 text-muted-foreground/50 text-xs">
              <span className="h-px flex-1 bg-border" />
              or
              <span className="h-px flex-1 bg-border" />
            </div>

            <Button
              type="button"
              variant="outline"
              onClick={handleGoogle}
              disabled={busy}
              className="w-full py-6 rounded-full tracking-widest uppercase text-xs gap-3 border-border"
              data-testid="button-google"
            >
              <GoogleGlyph />
              Continue with Google
            </Button>
          </div>
        )}
      </div>
    </PageShell>
  );
}

/** Google "G" mark (inline so no icon dependency / external asset is needed). */
function GoogleGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}
