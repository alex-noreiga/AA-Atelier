// The studio dashboard's internal tools — the atelier's own actions, run from a
// signed-in page instead of a link with a shared secret in its URL.
//
// Each card drives `POST /api/studio/tools/:tool`, which calls the same service
// the retired Notion link called. Three things this surface is responsible for,
// none of which a link could do:
//
//  1. **Naming what a tool does before it runs**, including that it moves money.
//     A formula-built URL is opaque — you press it and find out.
//  2. **Confirming the destructive ones.** The two refunds ask again, with the
//     order number echoed back, because a mis-typed number refunds a real
//     customer. The other three are safe to run at any time.
//  3. **Showing the outcome in place.** The server composes the summary (see
//     services/studio-tools.service.ts), so a result reads the same here as it
//     did on the confirmation page it replaces — and stays on screen next to the
//     tool that produced it rather than in a tab that has to be closed.
//
// Results are deliberately not persisted: this is a console, not a log. What
// happened is in Notion, Stripe, and the server's own logs.

import { useEffect, useRef, useState } from "react";
import {
  useRunStudioTool,
  type StudioTool,
  type StudioToolRun,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { serverErrorMessage } from "@/lib/api-error";
import { GuidesFor } from "@/components/studio-guides";
import type { ToolHandoff } from "@/lib/studio-handoff";
import {
  Loader2,
  Play,
  Wrench,
  AlertTriangle,
  CheckCircle2,
  MinusCircle,
} from "lucide-react";

/** The one free-text thing a tool acts on — an order number for most, an
 * inventory item name for the restock alert. Absent ⇒ the tool takes nothing. */
interface ToolField {
  /** The `StudioToolRequest` field it fills. */
  key: "orderNumber" | "item";
  label: string;
  placeholder: string;
  /** Suffix for the input's data-testid. */
  testId: string;
  /** May be left blank — the tool has a meaningful "all of them" mode. */
  optional?: boolean;
}

/** Every order-scoped tool asks the same way, so the descriptor is shared. */
const orderField = (placeholder: string): ToolField => ({
  key: "orderNumber",
  label: "Order number",
  placeholder,
  testId: "order",
});

/** What a tool asks the atelier for before it can run. */
interface ToolSpec {
  tool: StudioTool;
  name: string;
  /** What pressing it does, in the atelier's terms. */
  description: string;
  /** The field to collect before running; absent ⇒ the tool takes none. */
  field?: ToolField;
  /** Offer the "resend anyway" override (status-email only). */
  offersForce?: boolean;
  /** Offer a partial-refund amount (return refund only). */
  offersAmount?: boolean;
  /** Ask again before running — the tools that move money. */
  destructive?: boolean;
  /** The button's verb. */
  action: string;
}

const TOOLS: ToolSpec[] = [
  {
    tool: "milestones",
    name: "Reconcile production milestones",
    description:
      "Generates milestones for any order with a due date that hasn't got them, and sends any fitting, payment or appointment reminders now due.",
    action: "Run now",
  },
  {
    tool: "invoice-lines",
    name: "Itemize an invoice",
    description:
      "Writes the invoice's material, labor, and design & finishing lines from the order's costing.",
    field: orderField("ORD-000002"),
    action: "Itemize",
  },
  {
    tool: "status-email",
    name: "Send a status update",
    description:
      "Emails the customer their order's current stage with the pipeline graphic.",
    field: orderField("ORD-000002"),
    offersForce: true,
    action: "Send",
  },
  {
    tool: "cancellation-refund",
    name: "Cancel & refund an order",
    description:
      "Refunds every payment on a custom or shop order and marks it cancelled.",
    field: orderField("ORD-000002 or SHP-…"),
    destructive: true,
    action: "Refund & cancel",
  },
  {
    tool: "return-refund",
    name: "Refund a return",
    description:
      "Refunds a shop order for a return or exchange. Leave the amount blank to refund in full; an amount is the total that should end up refunded.",
    field: orderField("SHP-…"),
    offersAmount: true,
    destructive: true,
    action: "Refund",
  },
  {
    tool: "restock-alert",
    name: "Send back-in-stock alerts",
    description:
      "Emails everyone waiting on a piece that's come back in stock.",
    field: {
      key: "item",
      label: "Item name (optional)",
      placeholder: "All pieces in stock",
      testId: "item",
      optional: true,
    },
    action: "Send alerts",
  },
];

export function StudioTools({ handoff }: { handoff?: ToolHandoff }) {
  return (
    <section data-testid="panel-tools">
      <h2 className="flex items-center gap-2 text-xs tracking-[0.2em] uppercase text-muted-foreground mb-4">
        <Wrench className="w-4 h-4" strokeWidth={1.5} />
        Actions
      </h2>
      <div className="space-y-3">
        {TOOLS.map((spec) => (
          <ToolCard
            key={spec.tool}
            spec={spec}
            handoff={handoff?.tool === spec.tool ? handoff : undefined}
          />
        ))}
      </div>
    </section>
  );
}

function ToolCard({
  spec,
  handoff,
}: {
  spec: ToolSpec;
  /** A request in the queue above handing this tool its own argument. Only ever
   * set on the card the hand-off names. */
  handoff?: ToolHandoff;
}) {
  const [subject, setSubject] = useState("");
  const [amount, setAmount] = useState("");
  const [force, setForce] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [run, setRun] = useState<StudioToolRun | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mutation = useRunStudioTool();
  const card = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const field = spec.field;
  const missingSubject =
    Boolean(field) && !field?.optional && subject.trim() === "";

  // A request handing this tool its argument: fill the field, bring the card
  // into view, and put the cursor in it so the value can be read and corrected
  // before anything runs. Deliberately stops there — a hand-off prepares a run,
  // it never starts one, so the refunds keep their confirmation step. Keyed on
  // the hand-off's nonce, so pressing the same request twice re-scrolls (and
  // re-arms a confirmation that was dismissed) rather than doing nothing.
  useEffect(() => {
    if (!handoff) return;
    const value = handoff.orderNumber ?? handoff.item ?? "";
    setSubject(value);
    // Any previous result belongs to a different order; leaving it under a
    // freshly filled field would read as this request having been actioned.
    setRun(null);
    setError(null);
    setConfirming(false);
    card.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    input.current?.focus();
  }, [handoff]);

  const execute = () => {
    setConfirming(false);
    setRun(null);
    setError(null);
    mutation.mutate(
      {
        tool: spec.tool,
        data: {
          // A blank optional field is omitted rather than sent empty — for the
          // restock sweep that's the difference between "this piece" and "all".
          ...(field && subject.trim() ? { [field.key]: subject.trim() } : {}),
          ...(spec.offersForce && force ? { force: true } : {}),
          // A blank amount means "in full", which the contract expresses by
          // omitting the field — deliberately distinct from 0 (an even exchange).
          ...(spec.offersAmount && amount.trim() !== ""
            ? { amount: Number(amount) }
            : {}),
        },
      },
      {
        onSuccess: (result) => setRun(result),
        onError: (err) => setError(runErrorMessage(err)),
      },
    );
  };

  const start = () => {
    if (missingSubject) return;
    if (spec.destructive) {
      setConfirming(true);
      return;
    }
    execute();
  };

  const fieldId = `tool-${spec.tool}`;

  return (
    <div
      ref={card}
      className="rounded-sm border border-border bg-card/40 p-4 sm:p-5"
      data-testid={`tool-${spec.tool}`}
    >
      <h3 className="text-base font-serif text-foreground">{spec.name}</h3>
      <p className="mt-1 text-sm text-muted-foreground font-light">
        {spec.description}
      </p>

      {/* The atelier's own write-up of this procedure, when it has written one
          — the part the tool can't do, next to the button that does the rest.
          `spec.tool` IS the guide section id, so filing a guide against a tool
          needs no mapping table. Renders nothing when there is no guide. */}
      <GuidesFor section={spec.tool} />

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        {field && (
          <div className="w-full sm:flex-1 sm:min-w-[12rem]">
            <Label
              htmlFor={fieldId}
              className="text-[10px] tracking-[0.15em] uppercase text-muted-foreground"
            >
              {field.label}
            </Label>
            <Input
              id={fieldId}
              ref={input}
              value={subject}
              onChange={(event) => {
                setSubject(event.target.value);
                setConfirming(false);
              }}
              placeholder={field.placeholder}
              autoComplete="off"
              className="mt-1"
              data-testid={`tool-${spec.tool}-${field.testId}`}
            />
          </div>
        )}

        {spec.offersAmount && (
          <div className="w-full sm:w-32">
            <Label
              htmlFor={`${fieldId}-amount`}
              className="text-[10px] tracking-[0.15em] uppercase text-muted-foreground"
            >
              Amount
            </Label>
            <Input
              id={`${fieldId}-amount`}
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value);
                setConfirming(false);
              }}
              inputMode="decimal"
              placeholder="Full"
              autoComplete="off"
              className="mt-1"
              data-testid={`tool-${spec.tool}-amount`}
            />
          </div>
        )}

        <Button
          variant={spec.destructive ? "outline" : "default"}
          onClick={start}
          disabled={missingSubject || mutation.isPending}
          className="w-full gap-2 sm:w-auto"
          data-testid={`tool-${spec.tool}-run`}
        >
          {mutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.5} />
          ) : (
            <Play className="w-4 h-4" strokeWidth={1.5} />
          )}
          {spec.action}
        </Button>
      </div>

      {spec.offersForce && (
        <label
          htmlFor={`${fieldId}-force`}
          className="mt-3 flex items-center gap-2 cursor-pointer group w-fit"
        >
          <input
            id={`${fieldId}-force`}
            type="checkbox"
            checked={force}
            onChange={(event) => setForce(event.target.checked)}
            data-testid={`tool-${spec.tool}-force`}
            className="h-4 w-4 shrink-0 rounded-sm border-border text-primary accent-primary focus-visible:ring-primary"
          />
          <span className="text-sm font-light text-muted-foreground group-hover:text-foreground transition-colors">
            Resend even if the order hasn&apos;t moved forward
          </span>
        </label>
      )}

      {confirming && (
        <div
          className="mt-4 rounded-sm border border-destructive/40 bg-destructive/5 p-4"
          data-testid={`tool-${spec.tool}-confirm`}
        >
          <p className="text-sm text-foreground">
            This refunds real money on order{" "}
            <span className="font-medium">{subject.trim()}</span>
            {spec.offersAmount && amount.trim() !== ""
              ? `, up to a total of $${amount.trim()}`
              : " in full"}
            . Go ahead?
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              variant="destructive"
              size="sm"
              onClick={execute}
              data-testid={`tool-${spec.tool}-confirm-yes`}
            >
              Yes, {spec.action.toLowerCase()}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirming(false)}
              data-testid={`tool-${spec.tool}-confirm-no`}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {error && (
        <ToolResult
          tone="attention"
          title="Couldn't run"
          message={error}
          details={[]}
          testId={`tool-${spec.tool}-error`}
        />
      )}

      {run && (
        <ToolResult
          tone={run.status}
          title={run.title}
          message={run.message}
          details={run.details}
          testId={`tool-${spec.tool}-result`}
        />
      )}
    </div>
  );
}

/** One run's outcome, rendered from the server's own wording. */
function ToolResult({
  tone,
  title,
  message,
  details,
  testId,
}: {
  tone: StudioToolRun["status"];
  title: string;
  message: string;
  details: string[];
  testId: string;
}) {
  const attention = tone === "attention";
  const noop = tone === "noop";

  return (
    <div
      className={`mt-4 rounded-sm border p-4 ${
        attention
          ? "border-destructive/40 bg-destructive/5"
          : "border-border bg-muted/30"
      }`}
      data-testid={testId}
    >
      <p className="flex items-center gap-2 text-sm font-medium text-foreground">
        {attention ? (
          <AlertTriangle
            className="w-4 h-4 text-destructive shrink-0"
            strokeWidth={1.5}
          />
        ) : noop ? (
          <MinusCircle
            className="w-4 h-4 text-muted-foreground shrink-0"
            strokeWidth={1.5}
          />
        ) : (
          <CheckCircle2
            className="w-4 h-4 text-primary shrink-0"
            strokeWidth={1.5}
          />
        )}
        {title}
      </p>
      <p className="mt-1 text-sm text-muted-foreground font-light">{message}</p>
      {details.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground/90 font-light list-disc list-inside">
          {details.map((detail, index) => (
            <li key={index}>{detail}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The server's message for a failed run — a 400 naming what the tool needed, a
 * 404 for an unknown order. Shown verbatim, because those messages are written
 * for the atelier; a generic fallback covers a network drop or a 500.
 */
function runErrorMessage(error: unknown): string {
  return (
    serverErrorMessage(error) ??
    "Something went wrong. Please try again in a moment."
  );
}
