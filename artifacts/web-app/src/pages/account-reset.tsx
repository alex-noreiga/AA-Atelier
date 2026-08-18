import { useState } from "react";
import { useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/page-shell";
import { Seo } from "@/components/seo";
import { ROUTE_SEO } from "@/lib/seo-routes";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";

/**
 * Set-a-new-password screen. It's the redirect target of the password-reset
 * email: clicking that link establishes a short-lived recovery session (parsed
 * from the URL by supabase-js on load), which shows up here as a signed-in
 * session. The form then calls `updateUser({ password })` to set the new
 * password. If the link is missing/expired there's no session, so we prompt the
 * customer to request a fresh reset.
 */
export default function AccountReset() {
  const { session, loading } = useAuth();
  const [, navigate] = useLocation();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Please choose a password of at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Those passwords don't match.");
      return;
    }
    if (!supabase) return;
    setSaving(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    navigate("/account", { replace: true });
  };

  return (
    <PageShell>
      <Seo {...ROUTE_SEO["/account/reset"]} />
      <div className="w-full max-w-md z-10 mx-auto">
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-serif text-foreground mb-4">
            Set a new password
          </h1>
        </div>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2
              className="w-6 h-6 animate-spin text-primary"
              strokeWidth={1}
            />
          </div>
        ) : !session ? (
          <p
            className="text-center text-muted-foreground font-light"
            data-testid="reset-no-session"
          >
            This reset link has expired or already been used. Head back to{" "}
            <a href="/account/login" className="text-primary underline">
              sign in
            </a>{" "}
            and request a fresh one.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            <Input
              type="password"
              required
              placeholder="New password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full"
              data-testid="input-new-password"
            />
            <Input
              type="password"
              required
              placeholder="Confirm new password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full"
              data-testid="input-confirm-password"
            />
            {error && (
              <p
                className="text-center text-sm text-destructive font-light"
                data-testid="reset-error"
              >
                {error}
              </p>
            )}
            <div className="flex justify-center pt-2">
              <Button
                type="submit"
                disabled={saving}
                className="bg-primary text-primary-foreground hover:bg-primary/90 px-8 py-6 rounded-full tracking-widest uppercase text-xs"
                data-testid="button-set-password"
              >
                {saving ? (
                  <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.5} />
                ) : (
                  "Save password"
                )}
              </Button>
            </div>
          </form>
        )}
      </div>
    </PageShell>
  );
}
