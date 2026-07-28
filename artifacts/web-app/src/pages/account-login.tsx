import { useState } from "react";
import { useSearch } from "wouter";
import { useRequestMagicLink } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/page-shell";
import { Seo } from "@/components/seo";
import { ROUTE_SEO } from "@/lib/seo-routes";
import { Loader2, MailCheck } from "lucide-react";

/**
 * Passwordless sign-in for the customer account portal. The customer enters
 * their email and we send a one-time magic link (handled server-side); there is
 * no password. The response is intentionally identical whether or not any orders
 * exist for the address — identity is the email itself, so there's nothing to
 * enumerate. Arriving with `?error=expired` (a used/expired link bounces here)
 * shows a gentle prompt to request a fresh one.
 */
export default function AccountLogin() {
  const search = useSearch();
  const linkExpired = new URLSearchParams(search).get("error") === "expired";

  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);

  const requestLink = useRequestMagicLink({
    mutation: {
      onSuccess: (_data, variables) => setSentTo(variables.data.email),
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (trimmed) requestLink.mutate({ data: { email: trimmed } });
  };

  return (
    <PageShell>
      <Seo {...ROUTE_SEO["/account/login"]} />
      <div className="w-full max-w-md z-10 mx-auto animate-in fade-in zoom-in-95 duration-1000">
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-serif text-foreground mb-4">
            Your Account
          </h1>
          <p className="text-muted-foreground font-light text-lg">
            Sign in to see your orders and invoices in one place.
          </p>
        </div>

        {sentTo ? (
          <div
            className="text-center space-y-6 py-8 animate-in slide-in-from-bottom-4 fade-in duration-700"
            data-testid="login-sent"
          >
            <MailCheck
              className="w-10 h-10 text-primary mx-auto"
              strokeWidth={1}
            />
            <p className="text-foreground font-serif text-xl">
              Check your inbox
            </p>
            <p className="text-muted-foreground font-light">
              If we can reach you, a sign-in link is on its way to{" "}
              <span className="text-foreground">{sentTo}</span>. It expires in
              15 minutes.
            </p>
            <Button
              variant="outline"
              onClick={() => setSentTo(null)}
              className="border-primary/20 text-primary hover:bg-primary/10 rounded-full px-6"
              data-testid="button-use-different-email"
            >
              Use a different email
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            {linkExpired && (
              <p
                className="text-center text-sm text-destructive font-light"
                data-testid="login-expired"
              >
                That sign-in link has expired or already been used. Enter your
                email for a fresh one.
              </p>
            )}
            <div className="relative group">
              <Input
                type="email"
                required
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-transparent border-0 border-b border-border rounded-none px-4 py-6 text-center text-xl placeholder:text-muted-foreground/50 focus-visible:ring-0 focus-visible:border-primary transition-colors h-auto shadow-none"
                data-testid="input-email"
              />
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-0 h-[1px] bg-primary transition-all duration-500 group-focus-within:w-full"></div>
            </div>
            <p className="text-center text-xs text-muted-foreground/70 font-light tracking-wide">
              We&apos;ll email you a secure link — no password needed.
            </p>
            <div className="flex justify-center pt-4">
              <Button
                type="submit"
                disabled={!email.trim() || requestLink.isPending}
                className="bg-primary text-primary-foreground hover:bg-primary/90 px-8 py-6 rounded-full tracking-widest uppercase text-xs transition-all duration-300 hover:shadow-[0_0_24px_var(--glow-primary)] disabled:opacity-50 disabled:hover:shadow-none"
                data-testid="button-send-link"
              >
                {requestLink.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.5} />
                ) : (
                  "Email me a link"
                )}
              </Button>
            </div>
          </form>
        )}
      </div>
    </PageShell>
  );
}
