// The studio dashboard's stage board — where every order being made has got to,
// and the one press that moves it on.
//
// Advancing an order was the last routine atelier action that could only be done
// in Notion: open the database, find the row, change the `Stage` select, and
// trust that the automation watching that property noticed and emailed the
// customer. Everything about that was invisible from here — which order was
// waiting, whether the customer had been told, whether the automation fired.
//
// So the panel is responsible for three things a Notion column isn't:
//
//  1. **Saying where an order is, in its own pipeline.** "Stage 6 of 11" against
//     the stages this order's service actually walks, so a repair is never
//     measured against a commission's timeline.
//  2. **Making the ordinary case one press.** "Advance to Fitting" is the whole
//     interaction for the move that happens ninety-nine times in a hundred; the
//     stage picker beside it is for the other one, including moving an order
//     BACK, which is the other reason the atelier used to open Notion.
//  3. **Saying what the customer was told.** The email is sent by the same
//     action, so the result says whether it went — and when it didn't, why. A
//     stage that moved silently and a stage that emailed look identical in
//     Notion, which is the failure this replaces.

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListStudioOrders,
  useSetStudioOrderStage,
  getListStudioOrdersQueryKey,
  type OrderStageChange,
  type StudioOrderStage,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { serverErrorMessage } from "@/lib/api-error";
import {
  ArrowRight,
  CheckCircle2,
  Info,
  ListChecks,
  Loader2,
  MailX,
} from "lucide-react";

export function StudioOrders() {
  const board = useListStudioOrders({
    query: { queryKey: getListStudioOrdersQueryKey(), retry: false },
  });

  const orders = board.data?.orders ?? [];

  return (
    <section data-testid="panel-orders">
      <h2 className="flex items-center gap-2 text-xs tracking-[0.2em] uppercase text-muted-foreground mb-4">
        <ListChecks className="w-4 h-4" strokeWidth={1.5} />
        Orders in production
        {orders.length > 0 && (
          <span
            className="ml-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] tracking-normal text-primary"
            data-testid="orders-count"
          >
            {orders.length}
          </span>
        )}
      </h2>

      {board.isLoading ? (
        <div className="py-8 flex justify-center" data-testid="orders-loading">
          <Loader2
            className="w-5 h-5 animate-spin text-primary"
            strokeWidth={1}
          />
        </div>
      ) : board.isError ? (
        <p
          className="text-sm text-muted-foreground font-light"
          data-testid="orders-error"
        >
          {serverErrorMessage(board.error) ??
            "We couldn't load the orders just now."}
        </p>
      ) : orders.length === 0 ? (
        <p
          className="text-sm text-muted-foreground font-light"
          data-testid="orders-empty"
        >
          Nothing in production — every order is either delivered or cancelled.
        </p>
      ) : (
        <div className="space-y-3">
          {orders.map((order) => (
            <OrderCard key={order.orderNumber} order={order} />
          ))}
        </div>
      )}
    </section>
  );
}

/** One order, its position, and the two ways to move it. */
function OrderCard({ order }: { order: StudioOrderStage }) {
  const queryClient = useQueryClient();
  const [target, setTarget] = useState("");
  const [notify, setNotify] = useState(true);
  const [result, setResult] = useState<OrderStageChange | null>(null);
  const [error, setError] = useState<string | null>(null);
  const move = useSetStudioOrderStage();

  const position = order.stages.indexOf(order.currentStage);
  const fieldId = `order-${order.orderNumber}`;

  const run = (stage: string) => {
    setError(null);
    setResult(null);
    move.mutate(
      { orderNumber: order.orderNumber, data: { stage, notify } },
      {
        onSuccess: (data) => {
          setResult(data);
          setTarget("");
          void queryClient.invalidateQueries({
            queryKey: getListStudioOrdersQueryKey(),
          });
        },
        onError: (err) =>
          setError(
            serverErrorMessage(err) ?? "That stage change couldn't be saved.",
          ),
      },
    );
  };

  return (
    <article
      className="rounded-sm border border-border bg-card/40 p-4 sm:p-5"
      data-testid={`order-${order.orderNumber}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="font-serif text-base sm:text-lg min-w-0 break-words">
          {order.orderName || order.orderNumber}
        </h3>
        <span className="text-xs text-muted-foreground font-light tabular-nums">
          {order.orderNumber}
        </span>
      </div>

      <p className="mt-1 text-xs text-muted-foreground font-light">
        {[
          order.service,
          order.dueDate ? `Due ${formatDueDate(order.dueDate)}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>

      <p className="mt-3 text-sm font-light" data-testid={`${fieldId}-stage`}>
        {order.currentStage ? (
          <>
            <span className="text-foreground">{order.currentStage}</span>
            {position >= 0 && (
              <span className="text-muted-foreground">
                {" "}
                — stage {position + 1} of {order.stages.length}
              </span>
            )}
          </>
        ) : (
          <span className="text-muted-foreground italic">
            No stage set on this order yet.
          </span>
        )}
      </p>

      {/* The customer has been told up to here. Worth saying only when it is
          behind the current stage — otherwise it just repeats the line above. */}
      {order.lastNotifiedStage &&
        order.lastNotifiedStage !== order.currentStage && (
          <p className="mt-0.5 text-xs text-muted-foreground/80 font-light">
            Last emailed about {order.lastNotifiedStage}.
          </p>
        )}

      {!order.notifiable && (
        <p
          className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground font-light"
          data-testid={`${fieldId}-unreachable`}
        >
          <MailX className="w-3.5 h-3.5 mt-px shrink-0" strokeWidth={1.5} />
          No email on this order.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-end gap-2">
        {order.nextStage ? (
          <Button
            size="sm"
            onClick={() => run(order.nextStage as string)}
            disabled={move.isPending}
            data-testid={`${fieldId}-advance`}
          >
            {move.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={1.5} />
            ) : (
              <ArrowRight className="w-3.5 h-3.5" strokeWidth={1.5} />
            )}
            Advance to {order.nextStage}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground font-light">
            {order.currentStage
              ? "This is the last stage of this order's pipeline."
              : "Pick a stage below to start this order off."}
          </p>
        )}

        {/* The other move: any stage on this order's own pipeline, including one
            behind the current — which is how a mis-click is corrected without a
            trip to Notion. A backward move never emails. */}
        <div className="flex items-end gap-2">
          <select
            aria-label={`Move ${order.orderNumber} to another stage`}
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            className="h-9 rounded-sm border border-input bg-background px-2 text-sm max-w-[12rem]"
            data-testid={`${fieldId}-picker`}
          >
            <option value="">Move to…</option>
            {order.stages
              .filter((stage) => stage !== order.currentStage)
              .map((stage) => (
                <option key={stage} value={stage}>
                  {stage}
                </option>
              ))}
          </select>
          <Button
            size="sm"
            variant="outline"
            onClick={() => run(target)}
            disabled={!target || move.isPending}
            data-testid={`${fieldId}-set`}
          >
            Set
          </Button>
        </div>
      </div>

      <label
        htmlFor={`${fieldId}-notify`}
        className="mt-3 flex items-center gap-2 cursor-pointer group w-fit"
      >
        <input
          id={`${fieldId}-notify`}
          type="checkbox"
          checked={notify}
          disabled={!order.notifiable}
          onChange={(event) => setNotify(event.target.checked)}
          data-testid={`${fieldId}-notify`}
          className="h-4 w-4 shrink-0 rounded-sm border-border text-primary accent-primary focus-visible:ring-primary disabled:opacity-50"
        />
        <span className="text-sm font-light text-muted-foreground group-hover:text-foreground transition-colors">
          Email the customer about the new stage
        </span>
      </label>

      {error && (
        <p
          className="mt-3 text-sm text-destructive font-light"
          data-testid={`${fieldId}-error`}
        >
          {error}
        </p>
      )}

      {result && <ChangeResult result={result} testId={`${fieldId}-result`} />}
    </article>
  );
}

/** What the change did, in the atelier's terms — above all whether the customer
 * heard about it, which is the half Notion could never show. */
function ChangeResult({
  result,
  testId,
}: {
  result: OrderStageChange;
  testId: string;
}) {
  const sent = result.notification === "sent";
  return (
    <div
      className="mt-3 flex items-start gap-2 rounded-sm border border-border bg-background/60 p-3"
      data-testid={testId}
    >
      {sent ? (
        <CheckCircle2
          className="w-4 h-4 mt-0.5 shrink-0 text-primary"
          strokeWidth={1.5}
        />
      ) : (
        <Info
          className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground"
          strokeWidth={1.5}
        />
      )}
      <div className="text-sm font-light">
        <p>
          {result.changed
            ? `Moved from ${result.previousStage || "no stage"} to ${result.order.currentStage}.`
            : "That order was already at that stage, so nothing changed."}
        </p>
        <p className="text-muted-foreground">
          {sent
            ? "The customer has been emailed their updated timeline."
            : (result.notificationReason ?? "The customer wasn't emailed.")}
        </p>
      </div>
    </div>
  );
}

/** A due date is a calendar day, so it is formatted in UTC — parsed as an
 * instant and rendered in a western zone it would show the day before. */
function formatDueDate(date: string): string {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
