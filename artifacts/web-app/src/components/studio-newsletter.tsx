// The studio dashboard's newsletter panel.
//
// Marketing opt-ins land in the same contact inbox as the five request kinds but
// are a different job — nobody answers an opt-in, someone puts the address on
// the mailing list — so they have their own panel rather than a place in the
// request queue, which they would otherwise fill with rows that never close.
//
// The column that matters is **On the list**, and it is read live from Resend
// rather than from anything this page wrote. The app already tries to sync each
// opt-in at capture time, but that sync is best-effort and switched off entirely
// when no audience is configured — so an opt-in can sit in Notion having never
// reached the list, and a checkbox someone ticked here would be silent about
// exactly that case. Asking Resend is the only honest answer, and it is what
// turns this from a to-do list into a reconciliation.
//
// Two actions, and the difference between them is the point:
//
//  - **Add to the list** does the Resend add AND files the row away, so the two
//    halves of "I've dealt with this person" can't come apart.
//  - **Dismiss** files the row away without adding — for a bad address, or one
//    the atelier handled in Resend by hand. It writes the same `Stage` the
//    request queue writes, through the same operation.

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListNewsletterSignups,
  useSubscribeNewsletterSignup,
  useSetStudioRequestState,
  getListNewsletterSignupsQueryKey,
  type NewsletterSignup,
  type NewsletterAudienceStatus,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { serverErrorMessage } from "@/lib/api-error";
import {
  Check,
  Copy,
  ExternalLink,
  Loader2,
  Mails,
  Undo2,
  UserPlus,
  X,
} from "lucide-react";

export function StudioNewsletter() {
  const panel = useListNewsletterSignups({
    query: { queryKey: getListNewsletterSignupsQueryKey(), retry: false },
  });

  const pending = panel.data?.pending ?? [];
  const handled = panel.data?.handled ?? [];
  const audience = panel.data?.audience;

  return (
    <section data-testid="panel-newsletter">
      <h2 className="flex items-center gap-2 text-xs tracking-[0.2em] uppercase text-muted-foreground mb-4">
        <Mails className="w-4 h-4" strokeWidth={1.5} />
        Newsletter sign-ups
        {pending.length > 0 && (
          <span
            className="ml-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] tracking-normal text-primary"
            data-testid="newsletter-pending-count"
          >
            {pending.length} to add
          </span>
        )}
      </h2>

      {panel.isLoading ? (
        <div
          className="py-8 flex justify-center"
          data-testid="newsletter-loading"
        >
          <Loader2
            className="w-5 h-5 animate-spin text-primary"
            strokeWidth={1}
          />
        </div>
      ) : panel.isError ? (
        <p
          className="text-sm text-muted-foreground font-light"
          data-testid="newsletter-error"
        >
          {serverErrorMessage(panel.error) ??
            "We couldn't load the newsletter sign-ups just now."}
        </p>
      ) : (
        <div className="space-y-3">
          {audience && <AudienceNote audience={audience} />}

          {pending.length === 0 && (
            <p
              className="text-sm text-muted-foreground font-light"
              data-testid="newsletter-empty"
            >
              Nothing waiting.
            </p>
          )}

          {pending.map((signup) => (
            <SignupRow key={signup.id} signup={signup} />
          ))}

          {handled.length > 0 && (
            <details className="pt-2" data-testid="newsletter-handled">
              <summary className="cursor-pointer text-xs tracking-[0.15em] uppercase text-muted-foreground/80">
                Already dealt with ({handled.length})
              </summary>
              <div className="mt-3 space-y-3">
                {handled.map((signup) => (
                  <SignupRow key={signup.id} signup={signup} />
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {panel.data?.truncated && (
        <p
          className="mt-2 text-xs text-muted-foreground/80 font-light"
          data-testid="newsletter-truncated"
        >
          Only the oldest sign-ups are listed here; the rest are in Notion.
        </p>
      )}
    </section>
  );
}

/** What the panel can and can't tell you about the mailing list, said once at
 * the top rather than repeated as an unexplained "Unknown" on every row. */
function AudienceNote({ audience }: { audience: NewsletterAudienceStatus }) {
  if (!audience.configured) {
    return (
      <p
        className="rounded-sm border border-border bg-muted/30 p-3 text-xs text-muted-foreground font-light"
        data-testid="newsletter-unconfigured"
      >
        No Resend audience is connected, so nobody can be added from here and
        the site&apos;s own sign-up sync is off too. Set{" "}
        <code className="text-foreground">RESEND_AUDIENCE_ID</code> to the
        audience you send broadcasts from.
      </p>
    );
  }

  if (audience.unreachable) {
    return (
      <p
        className="rounded-sm border border-border bg-muted/30 p-3 text-xs text-muted-foreground font-light"
        data-testid="newsletter-unreachable"
      >
        We couldn&apos;t reach Resend just now, so these sign-ups are listed
        without saying whether they&apos;re already on the list. Try again in a
        moment before adding anyone.
      </p>
    );
  }

  return null;
}

/** One opt-in: the address, where it came from, and what can be done with it. */
function SignupRow({ signup }: { signup: NewsletterSignup }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const subscribe = useSubscribeNewsletterSignup();
  const move = useSetStudioRequestState();

  const refresh = () =>
    void queryClient.invalidateQueries({
      queryKey: getListNewsletterSignupsQueryKey(),
    });

  const add = () => {
    setError(null);
    subscribe.mutate(
      { signupId: signup.id },
      {
        onSuccess: refresh,
        onError: (err) =>
          setError(
            serverErrorMessage(err) ?? "That sign-up couldn't be added.",
          ),
      },
    );
  };

  const setState = (state: "new" | "closed") => {
    setError(null);
    move.mutate(
      { requestId: signup.id, data: { state } },
      {
        onSuccess: refresh,
        onError: (err) =>
          setError(serverErrorMessage(err) ?? "That couldn't be saved."),
      },
    );
  };

  const copyEmail = async () => {
    if (!signup.email) return;
    try {
      await navigator.clipboard.writeText(signup.email);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // A blocked clipboard is not worth an error panel — the address is on
      // screen and can be selected by hand.
    }
  };

  const busy = subscribe.isPending || move.isPending;
  // Offered only when we know they're not on the list. `unknown` means we
  // couldn't ask, and pressing Add then would be a guess.
  const canAdd = signup.subscription === "absent";

  return (
    <article
      className="rounded-sm border border-border bg-card/40 p-4 sm:p-5"
      data-testid={`signup-${signup.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-foreground break-all">
            {signup.email ?? "No address recorded"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground font-light">
            {[
              signup.source ? `via the ${signup.source}` : null,
              formatSubmitted(signup.submittedAt),
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <SubscriptionBadge signup={signup} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {canAdd && (
          <Button
            size="sm"
            disabled={busy}
            onClick={add}
            className="gap-1.5"
            data-testid={`signup-add-${signup.id}`}
          >
            {subscribe.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={2} />
            ) : (
              <UserPlus className="w-3.5 h-3.5" strokeWidth={2} />
            )}
            Add to the list
          </Button>
        )}

        {signup.email && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void copyEmail()}
            className="gap-1.5"
            data-testid={`signup-copy-${signup.id}`}
          >
            {copied ? (
              <Check className="w-3.5 h-3.5" strokeWidth={2} />
            ) : (
              <Copy className="w-3.5 h-3.5" strokeWidth={1.5} />
            )}
            {copied ? "Copied" : "Copy address"}
          </Button>
        )}

        {signup.state !== "closed" ? (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => setState("closed")}
            className="gap-1.5"
            data-testid={`signup-dismiss-${signup.id}`}
          >
            <X className="w-3.5 h-3.5" strokeWidth={2} />
            Dismiss
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => setState("new")}
            className="gap-1.5 text-xs"
            data-testid={`signup-reopen-${signup.id}`}
          >
            <Undo2 className="w-3.5 h-3.5" strokeWidth={1.5} />
            Put back
          </Button>
        )}

        {signup.notionUrl && (
          <a
            href={signup.notionUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary sm:ml-auto"
            data-testid={`signup-notion-${signup.id}`}
          >
            <ExternalLink className="w-3.5 h-3.5" strokeWidth={1.5} />
            Open in Notion
          </a>
        )}
      </div>

      {error && (
        <p
          className="mt-3 text-sm text-destructive"
          data-testid={`signup-error-${signup.id}`}
        >
          {error}
        </p>
      )}
    </article>
  );
}

/** Whether this address is on the mailing list — the whole reason the panel
 * exists, so it reads as a status rather than a decoration.
 *
 * There is no "unsubscribed" here on purpose. Resend owns unsubscribes and
 * honours them on every broadcast, so someone who opted out is somebody the
 * studio has nothing left to do about: they read as on the list, and the Add
 * button isn't offered for them any more than for anyone else Resend holds. */
function SubscriptionBadge({ signup }: { signup: NewsletterSignup }) {
  const { label, tone } = {
    subscribed: { label: "On the list", tone: "bg-primary/10 text-primary" },
    absent: {
      label: "Not on the list",
      tone: "bg-destructive/10 text-destructive",
    },
    unknown: { label: "Unknown", tone: "bg-muted text-muted-foreground" },
  }[signup.subscription];

  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] tracking-[0.12em] uppercase ${tone}`}
      data-testid={`signup-subscription-${signup.id}`}
    >
      {label}
    </span>
  );
}

/** "Signed up August 1, 2026" — the date says how long someone has been waiting
 * to hear from a list they asked to be on. */
function formatSubmitted(iso?: string): string {
  if (!iso) return "Signed up at an unknown time";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Signed up at an unknown time";
  return `Signed up ${date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })}`;
}
