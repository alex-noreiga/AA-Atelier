// The signed-in customer's data rights, on the account dashboard: take a copy
// of everything the studio holds, or ask for it to be deleted.
//
// Both live here rather than on the privacy page because both are answered by
// the session — the server looks nothing up but the email the customer is
// signed in with, so a page anyone can read is the wrong place to offer them.
// The privacy policy points here instead.
//
// The two buttons deliberately don't look alike. The export is a plain,
// immediate action: press it and a file downloads. Deletion asks a second time
// with the consequences written out, because it is the only control in the
// portal whose effect the customer cannot undo themselves — and even then, what
// it files is a request to a person, which the copy says rather than implying a
// button erased anything.

import { useState } from "react";
import {
  useExportAccountData,
  useRequestAccountDeletion,
  getExportAccountDataQueryKey,
  type AccountDataExport,
  type AccountDeletionRequestResult,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { serverErrorMessage } from "@/lib/api-error";
import { CONTACT_EMAIL } from "@/lib/contact-info";
import { Download, Loader2, ShieldCheck, Trash2 } from "lucide-react";

/** The filename the export saves as. Dated, because a customer who exports
 * twice a year should be able to tell the two files apart. */
function exportFilename(generatedAt: string): string {
  const day = (generatedAt || new Date().toISOString()).slice(0, 10);
  return `aa-atelier-my-data-${day}.json`;
}

/**
 * Hand the export to the browser as a file.
 *
 * Guarded on `URL.createObjectURL` because the save is the one part of this that
 * depends on the environment rather than on our own code — it is absent in some
 * privacy-hardened browsers and in a headless renderer. Returns whether the file
 * was actually saved, so the caller can say the data is ready but couldn't be
 * written rather than claiming a download that never happened.
 */
function saveExport(data: AccountDataExport): boolean {
  if (typeof URL.createObjectURL !== "function") return false;

  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = exportFilename(data.generatedAt);
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return true;
}

export function AccountData() {
  return (
    <section data-testid="account-data">
      <h2 className="flex items-center gap-2 text-xs tracking-[0.2em] uppercase text-muted-foreground mb-4">
        <ShieldCheck className="w-4 h-4" strokeWidth={1.5} />
        Your data
      </h2>
      <div className="rounded-sm border border-border bg-card/40 p-5 space-y-6">
        <p className="text-sm text-muted-foreground font-light">
          Everything we hold about you is filed under the email address you sign
          in with: your orders and measurements, your appointments, our contact
          record for you, anything you&apos;ve sent us, and any review
          you&apos;ve written.
        </p>
        <ExportControl />
        <div className="border-t border-border/60 pt-6">
          <DeletionControl />
        </div>
      </div>
    </section>
  );
}

/** "Download my data" — fetches the export on demand and saves it as JSON. */
function ExportControl() {
  const [message, setMessage] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);

  // Fetched on press, not on page load: it is the heaviest read in the portal
  // (every store the app writes personal data into), and nobody opens their
  // account to download a file.
  const exportQuery = useExportAccountData({
    query: {
      queryKey: getExportAccountDataQueryKey(),
      enabled: false,
      retry: false,
      // Not cached between presses: this is a snapshot of the customer's data
      // taken on request, and handing them a minutes-old one on a second press
      // would be answering a fresh question with a stale file.
      gcTime: 0,
    },
  });

  const download = async () => {
    setMessage(null);
    setMissing([]);
    const result = await exportQuery.refetch();

    if (result.error || !result.data) {
      setMessage(
        serverErrorMessage(result.error) ??
          "We couldn't put your data together just now. Please try again in a moment.",
      );
      return;
    }

    setMissing(result.data.unavailable);
    setMessage(
      saveExport(result.data)
        ? "Your data has been downloaded."
        : "Your data is ready, but this browser wouldn't let us save the file.",
    );
  };

  return (
    <div className="space-y-3">
      <Button
        variant="outline"
        onClick={() => void download()}
        disabled={exportQuery.isFetching}
        className="gap-2 text-xs tracking-widest uppercase"
        data-testid="button-export-data"
      >
        {exportQuery.isFetching ? (
          <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.5} />
        ) : (
          <Download className="w-4 h-4" strokeWidth={1.5} />
        )}
        {exportQuery.isFetching ? "Gathering" : "Download my data"}
      </Button>
      <p className="text-xs text-muted-foreground/70">
        A JSON file, which you can open in any text editor. Photographs you
        uploaded aren&apos;t included — email us and we&apos;ll send them.
      </p>
      {message && (
        <p className="text-sm text-foreground" data-testid="export-message">
          {message}
        </p>
      )}
      {/* Named, never quietly left out: an export missing something without
          saying so is a wrong answer, not a smaller one. */}
      {missing.length > 0 && (
        <p
          className="text-sm text-muted-foreground"
          data-testid="export-unavailable"
        >
          We couldn&apos;t include {missing.join(", ")} this time. Try again
          shortly, or email us at{" "}
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="text-primary hover:underline"
          >
            {CONTACT_EMAIL}
          </a>{" "}
          and we&apos;ll send that part on.
        </p>
      )}
    </div>
  );
}

/** What the studio did about the mailing list, in the customer's words. */
const MARKETING_OUTCOME: Record<
  AccountDeletionRequestResult["marketing"],
  string
> = {
  unsubscribed: "You've been taken off our mailing list already.",
  absent: "You weren't on our mailing list, so there was nothing to remove.",
  unavailable: "We'll take you off our mailing list as part of this.",
};

/** "Request deletion" — files an erasure request, after asking again. */
function DeletionControl() {
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState("");

  const request = useRequestAccountDeletion({ mutation: { retry: false } });
  const result = request.data;

  if (result) {
    return (
      <div className="space-y-2" data-testid="deletion-filed">
        <p className="text-sm text-foreground">
          {result.alreadyRequested
            ? "Your deletion request is already with us — we haven't filed a second one."
            : "Your deletion request is with us. We'll write to you once it's been reviewed."}
        </p>
        <p className="text-sm text-muted-foreground">
          {MARKETING_OUTCOME[result.marketing]}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm text-foreground">Delete my data</h3>
      <p className="text-sm text-muted-foreground font-light">
        We&apos;ll take you off our mailing list straight away and review the
        rest by hand. Some records — an invoice, a payment record — we may have
        to keep for a period, and we&apos;ll tell you if that applies to
        anything of yours.
      </p>

      {confirming ? (
        <div className="space-y-3">
          <Textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Anything we should know? (optional) — for instance, if you'd like us to finish an order first."
            rows={3}
            maxLength={2000}
            className="text-sm"
            data-testid="deletion-note"
          />
          {request.isError && (
            <p
              className="text-sm text-destructive"
              data-testid="deletion-error"
            >
              {serverErrorMessage(request.error) ??
                "We couldn't file your request just now. Please try again in a moment."}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="destructive"
              disabled={request.isPending}
              onClick={() =>
                request.mutate({
                  data: note.trim() ? { note: note.trim() } : {},
                })
              }
              className="gap-2 text-xs tracking-widest uppercase"
              data-testid="button-confirm-deletion"
            >
              {request.isPending && (
                <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.5} />
              )}
              Send the request
            </Button>
            <Button
              variant="ghost"
              disabled={request.isPending}
              onClick={() => setConfirming(false)}
              className="text-xs tracking-widest uppercase text-muted-foreground"
              data-testid="button-cancel-deletion"
            >
              Never mind
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="outline"
          onClick={() => setConfirming(true)}
          className="gap-2 text-xs tracking-widest uppercase"
          data-testid="button-request-deletion"
        >
          <Trash2 className="w-4 h-4" strokeWidth={1.5} />
          Request deletion
        </Button>
      )}
    </div>
  );
}
