// The studio dashboard's customer-request queue.
//
// Six kinds of request have been landing in the atelier's shared contact inbox
// since each flow shipped — a measurement change, a cancellation, a return or
// exchange, a back-in-stock ask, a website inquiry — and the app only ever wrote
// them. Working one meant opening Notion, reading the row, and re-typing its
// order number into one of the tools below. This is that queue, on the surface
// where the tools already are.
//
// What the panel is responsible for, beyond a list:
//
//  - **Handing the request to its tool.** A row's action is decided by the
//    server (see `requests.schema.ts`), so pressing it fills the matching tool
//    card, scrolls to it and lets the atelier confirm — the refunds keep their
//    "ask again with the number echoed back" step, because that is what makes a
//    mis-typed number impossible rather than merely unlikely.
//  - **Saying when there is no button, and what to do instead.** A measurement
//    change is applied to the order by hand and an inquiry is answered by
//    email; offering a button that did nothing would be worse than offering
//    none.
//  - **Working the queue down.** Marking a request replied or closed is the
//    only thing this writes, and every state is reversible — so a row closed by
//    mistake is one press to put back, not a trip to Notion.

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListStudioRequests,
  useSetStudioRequestState,
  getListStudioRequestsQueryKey,
  type StudioRequest,
  type StudioRequestKind,
  type StudioRequestState,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { serverErrorMessage } from "@/lib/api-error";
import type { ToolHandoff } from "@/lib/studio-handoff";

/** What a card emits: the tool and its argument. The page stamps it into a
 * full {@link ToolHandoff} so repeated presses stay distinguishable. */
type HandoffRequest = Omit<ToolHandoff, "nonce">;
import {
  Check,
  ExternalLink,
  Inbox,
  Loader2,
  Mail,
  Play,
  Reply,
  Undo2,
} from "lucide-react";

/** How each kind reads in the queue, and what the atelier does about it when
 * the server offers no tool. The label is the customer's language, not the
 * Notion option name — "Return / exchange" is a filter value, "Return or
 * exchange" is a sentence. */
const KIND_LABELS: Record<StudioRequestKind, string> = {
  inquiry: "Inquiry",
  "back-in-stock": "Back in stock",
  measurement: "Measurement change",
  cancellation: "Cancellation",
  return: "Return or exchange",
  // Never reaches this queue — an opt-in is filtered out server-side and has
  // its own panel. The map stays total so a kind added later can't be missed.
  newsletter: "Newsletter sign-up",
  other: "Request",
};

/** What to do with a request the app can't action for you. Absent for the kinds
 * that carry a tool — the button says it instead. */
const MANUAL_GUIDANCE: Partial<Record<StudioRequestKind, string>> = {
  measurement:
    "Apply the new measurements to the order in Notion — the app never edits an order's measurements itself.",
  inquiry: "Answer this by email, then mark it replied.",
};

/** The verb on each tool's hand-off button, matching the tool card it fills. */
const ACTION_LABELS: Record<string, string> = {
  "cancellation-refund": "Refund & cancel",
  "return-refund": "Refund this return",
  "restock-alert": "Send back-in-stock alerts",
};

export function StudioRequests({
  onHandoff,
}: {
  /** Fill the matching tool card with this request's own argument. The tools
   * panel owns the confirmation, so this only ever prepares a run. */
  onHandoff: (handoff: HandoffRequest) => void;
}) {
  const queue = useListStudioRequests({
    query: { queryKey: getListStudioRequestsQueryKey(), retry: false },
  });

  const open = queue.data?.open ?? [];
  const closed = queue.data?.closed ?? [];

  return (
    <section data-testid="panel-requests">
      <h2 className="flex items-center gap-2 text-xs tracking-[0.2em] uppercase text-muted-foreground mb-4">
        <Inbox className="w-4 h-4" strokeWidth={1.5} />
        Customer requests
        {open.length > 0 && (
          <span
            className="ml-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] tracking-normal text-primary"
            data-testid="requests-open-count"
          >
            {open.length} open
          </span>
        )}
      </h2>

      {queue.isLoading ? (
        <div
          className="py-8 flex justify-center"
          data-testid="requests-loading"
        >
          <Loader2
            className="w-5 h-5 animate-spin text-primary"
            strokeWidth={1}
          />
        </div>
      ) : queue.isError ? (
        <p
          className="text-sm text-muted-foreground font-light"
          data-testid="requests-error"
        >
          {serverErrorMessage(queue.error) ??
            "We couldn't load the customer requests just now."}
        </p>
      ) : (
        <div className="space-y-3">
          {open.length === 0 && (
            <p
              className="text-sm text-muted-foreground font-light"
              data-testid="requests-empty"
            >
              Nothing waiting.
            </p>
          )}

          {open.map((request) => (
            <RequestCard
              key={request.id}
              request={request}
              onHandoff={onHandoff}
            />
          ))}

          {closed.length > 0 && (
            <details className="pt-2" data-testid="requests-closed">
              <summary className="cursor-pointer text-xs tracking-[0.15em] uppercase text-muted-foreground/80">
                Recently closed ({closed.length})
              </summary>
              <div className="mt-3 space-y-3">
                {closed.map((request) => (
                  <RequestCard
                    key={request.id}
                    request={request}
                    onHandoff={onHandoff}
                  />
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {queue.data?.truncated && (
        <p
          className="mt-2 text-xs text-muted-foreground/80 font-light"
          data-testid="requests-truncated"
        >
          Only the oldest open requests are listed here; the rest are in Notion.
        </p>
      )}
    </section>
  );
}

/** One request, with its hand-off and the states open to it. */
function RequestCard({
  request,
  onHandoff,
}: {
  request: StudioRequest;
  onHandoff: (handoff: HandoffRequest) => void;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const move = useSetStudioRequestState();

  const set = (state: StudioRequestState) => {
    setError(null);
    move.mutate(
      { requestId: request.id, data: { state } },
      {
        onSuccess: () =>
          void queryClient.invalidateQueries({
            queryKey: getListStudioRequestsQueryKey(),
          }),
        onError: (err) =>
          setError(serverErrorMessage(err) ?? "That couldn't be saved."),
      },
    );
  };

  const byline = [request.customerName, request.email, request.phone]
    .filter(Boolean)
    .join(" · ");
  const guidance = MANUAL_GUIDANCE[request.kind];
  const action = request.action;

  return (
    <article
      className="rounded-sm border border-border bg-card/40 p-4 sm:p-5"
      data-testid={`request-${request.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] tracking-[0.15em] uppercase text-muted-foreground">
            {KIND_LABELS[request.kind]}
            {request.kind === "other" && request.rawType
              ? ` · ${request.rawType}`
              : ""}
          </p>
          <h3 className="mt-1 text-base font-serif text-foreground break-words">
            {request.subject}
          </h3>
          {byline && (
            <p className="mt-1 text-xs text-muted-foreground font-light break-all">
              {byline}
            </p>
          )}
          <p className="mt-0.5 text-xs text-muted-foreground/70 font-light">
            {formatSubmitted(request.submittedAt)}
          </p>
        </div>
        <StateBadge state={request.state} requestId={request.id} />
      </div>

      {request.message && (
        <p className="mt-4 text-sm text-foreground font-light leading-relaxed whitespace-pre-line">
          {request.message}
        </p>
      )}

      {(request.item || request.size) && (
        <p
          className="mt-3 text-xs text-muted-foreground font-light"
          data-testid={`request-item-${request.id}`}
        >
          {[request.item, request.size].filter(Boolean).join(" · ")}
        </p>
      )}

      {guidance && (
        <p
          className="mt-3 text-xs text-muted-foreground font-light"
          data-testid={`request-guidance-${request.id}`}
        >
          {guidance}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {action && (
          <Button
            size="sm"
            onClick={() =>
              onHandoff({
                tool: action.tool,
                orderNumber: action.orderNumber,
                item: action.item,
              })
            }
            className="gap-1.5"
            data-testid={`request-action-${request.id}`}
          >
            <Play className="w-3.5 h-3.5" strokeWidth={2} />
            {ACTION_LABELS[action.tool] ?? "Run the tool"}
          </Button>
        )}

        {request.email && (
          <a
            href={`mailto:${request.email}?subject=${encodeURIComponent(
              `Re: ${request.subject}`,
            )}`}
            className="inline-flex items-center gap-1.5 rounded-sm border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-primary"
            data-testid={`request-email-${request.id}`}
          >
            <Mail className="w-3.5 h-3.5" strokeWidth={1.5} />
            Email
          </a>
        )}

        {request.state !== "replied" && request.state !== "closed" && (
          <Button
            variant="outline"
            size="sm"
            disabled={move.isPending}
            onClick={() => set("replied")}
            className="gap-1.5"
            data-testid={`request-replied-${request.id}`}
          >
            <Reply className="w-3.5 h-3.5" strokeWidth={2} />
            Mark replied
          </Button>
        )}

        {request.state !== "closed" ? (
          <Button
            variant="outline"
            size="sm"
            disabled={move.isPending}
            onClick={() => set("closed")}
            className="gap-1.5"
            data-testid={`request-close-${request.id}`}
          >
            {move.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={2} />
            ) : (
              <Check className="w-3.5 h-3.5" strokeWidth={2} />
            )}
            Close
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            disabled={move.isPending}
            onClick={() => set("new")}
            className="gap-1.5 text-xs"
            data-testid={`request-reopen-${request.id}`}
          >
            <Undo2 className="w-3.5 h-3.5" strokeWidth={1.5} />
            Reopen
          </Button>
        )}

        {request.notionUrl && (
          <a
            href={request.notionUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary sm:ml-auto"
            data-testid={`request-notion-${request.id}`}
          >
            <ExternalLink className="w-3.5 h-3.5" strokeWidth={1.5} />
            Open in Notion
          </a>
        )}
      </div>

      {error && (
        <p
          className="mt-3 text-sm text-destructive"
          data-testid={`request-error-${request.id}`}
        >
          {error}
        </p>
      )}
    </article>
  );
}

function StateBadge({
  state,
  requestId,
}: {
  state: StudioRequestState;
  requestId: string;
}) {
  const label =
    state === "closed" ? "Closed" : state === "replied" ? "Replied" : "New";
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] tracking-[0.12em] uppercase ${
        state === "closed"
          ? "bg-muted text-muted-foreground"
          : "bg-primary/10 text-primary"
      }`}
      data-testid={`request-state-${requestId}`}
    >
      {label}
    </span>
  );
}

/** "Filed August 1, 2026" — the day matters here, because it says how long a
 * request has been waiting. */
function formatSubmitted(iso?: string): string {
  if (!iso) return "Filed at an unknown time";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Filed at an unknown time";
  return `Filed ${date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })}`;
}
