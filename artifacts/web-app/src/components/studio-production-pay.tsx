// The studio dashboard's production pay — what the studio owes its own people.
//
// Every other figure on this dashboard is money coming IN: revenue by month,
// deposits against balances, what customers still owe. The atelier has recorded
// what goes OUT by hand since before the app existed — who did the consult, the
// sourcing, the cutting, the sewing and the detailing on each item, and what
// each of those is worth as a share of the piece — and nothing ever read it.
// This is that read.
//
// What the panel is responsible for, beyond listing rows:
//
//  - **Leading with what is owed, per person.** That is the question this is
//    opened to answer, and it is the one the atelier settles against. What each
//    maker is owed FOR — sewing rather than sourcing — is under the name,
//    because a single total per person is already readable in Notion; the
//    breakdown is what a per-person formula structurally cannot produce.
//  - **Showing a maker who is square as square.** The server sends the whole
//    roster, including anyone at nought, so this reads as the studio's payroll
//    rather than as a list of who happens to be owed money today.
//  - **Never quietly totalling less than the truth.** A row with no sale price,
//    no category, or a stage nobody is assigned to holds money that may be owed
//    and is in no total. Those are listed, with the reason — the same call the
//    materials panel's "not watched" list makes, and for a payroll figure it
//    matters more: a number that looks complete while it is short is the worst
//    way for this panel to be wrong.
//  - **Saying when it isn't wired up.** Either database unset renders which
//    one, never an empty panel — nought owed reads as "everyone has been paid",
//    which is a very different claim from "we aren't tracking this".

import { useState } from "react";
import {
  useGetStudioProductionPay,
  getGetStudioProductionPayQueryKey,
  type MakerPay,
  type ProductionPayItem,
  type ProductionPayAttention,
} from "@workspace/api-client-react";
import { serverErrorMessage } from "@/lib/api-error";
import { ChevronDown, Coins, Loader2 } from "lucide-react";

/** How a stage id reads to the atelier. The server sends the id; the wording
 * is the dashboard's, and matches the Notion column each one comes from. */
const STAGE_LABELS: Record<string, string> = {
  consult: "Consult & sketch",
  sourcing: "Sourcing",
  cutting: "Cutting & pinning",
  sewing: "Sewing",
  detailing: "Detailing",
};

function stageLabel(stage: string): string {
  return STAGE_LABELS[stage] ?? stage;
}

/** Money, to the cent. Production pay is a figure somebody is paid against, so
 * unlike a shop price it always shows both decimal places — "$87.50" and
 * "$87.00" are the same kind of number here and should line up. */
function money(amount: number): string {
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Why a row couldn't be computed, in the atelier's own terms — each says what
 * to go and fill in, since every one of these is a row only they can fix. */
function attentionReason(entry: ProductionPayAttention): string {
  switch (entry.reason) {
    case "no-sale-price":
      return "No sale price, so there's nothing to divide. Add one in Notion.";
    case "no-pay-split":
      return "No category, so there are no pay splits to divide by. Link one in Notion.";
    case "unassigned-stages":
      return `${money(entry.unassigned ?? 0)} of work has nobody against it. Fill in who did which stage.`;
  }
}

export function StudioProductionPay() {
  const pay = useGetStudioProductionPay({
    query: { queryKey: getGetStudioProductionPayQueryKey(), retry: false },
  });

  const data = pay.data;

  return (
    <section data-testid="panel-production-pay">
      <h2 className="flex items-center gap-2 text-xs tracking-[0.2em] uppercase text-muted-foreground mb-4">
        <Coins className="w-4 h-4" strokeWidth={1.5} />
        Production pay
        {data?.configured && data.totalOwed > 0 && (
          <span
            className="ml-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] tracking-normal text-primary"
            data-testid="production-pay-owed-badge"
          >
            {money(data.totalOwed)} owed
          </span>
        )}
      </h2>

      {pay.isLoading ? (
        <div
          className="py-8 flex justify-center"
          data-testid="production-pay-loading"
        >
          <Loader2
            className="w-5 h-5 animate-spin text-primary"
            strokeWidth={1}
          />
        </div>
      ) : pay.isError ? (
        <p
          className="text-sm text-muted-foreground font-light"
          data-testid="production-pay-error"
        >
          {serverErrorMessage(pay.error) ??
            "We couldn't load production pay just now."}
        </p>
      ) : data && !data.configured ? (
        <UnconfiguredNote missing={data.missing ?? []} />
      ) : data?.unreachable ? (
        <p
          className="text-sm text-muted-foreground font-light"
          data-testid="production-pay-unreachable"
        >
          Notion can’t find one of the production-pay databases, so nothing can
          be worked out. Open “work distribution” and “Category Pay Splits” in
          Notion and share each with the integration (⋯ → Connections), and
          check NOTION_WORK_DISTRIBUTION_DATABASE_ID and
          NOTION_PAY_SPLITS_DATABASE_ID hold those databases’ ids.
        </p>
      ) : data ? (
        <div className="space-y-8">
          <Makers makers={data.makers} totalPaid={data.totalPaid} />
          <UnbalancedNote splits={data.unbalancedSplits} />
          <Items items={data.items} itemCount={data.itemCount} />
          <NeedsAttention
            entries={data.needsAttention}
            total={data.attentionCount}
          />
        </div>
      ) : null}
    </section>
  );
}

function UnconfiguredNote({ missing }: { missing: string[] }) {
  // Naming the missing half matters: the two databases are set up separately,
  // and "production pay isn't connected" would send the atelier looking at both.
  const both = missing.length === 2;
  return (
    <p
      className="text-sm text-muted-foreground font-light"
      data-testid="production-pay-unconfigured"
    >
      {both
        ? "Production pay isn’t connected yet. Set NOTION_WORK_DISTRIBUTION_DATABASE_ID and NOTION_PAY_SPLITS_DATABASE_ID, and share the Notion integration with the “work distribution” and “Category Pay Splits” databases."
        : missing[0] === "work-distribution"
          ? "The “work distribution” database isn’t connected, so there’s no record of who made what. Set NOTION_WORK_DISTRIBUTION_DATABASE_ID and share the Notion integration with it."
          : "The “Category Pay Splits” database isn’t connected, so there’s nothing to divide each piece by. Set NOTION_PAY_SPLITS_DATABASE_ID and share the Notion integration with it."}
    </p>
  );
}

function Makers({
  makers,
  totalPaid,
}: {
  makers: MakerPay[];
  totalPaid: number;
}) {
  if (makers.length === 0) {
    return (
      <p
        className="text-sm text-muted-foreground font-light"
        data-testid="production-pay-empty"
      >
        No production work has been recorded yet. Add a row to the “work
        distribution” database in Notion for each item as it’s made.
      </p>
    );
  }

  return (
    <div>
      <div
        className="grid gap-3 sm:grid-cols-2"
        data-testid="production-pay-makers"
      >
        {makers.map((maker) => (
          <div
            key={maker.maker}
            className="rounded-sm border border-border/60 p-4"
            data-testid={`maker-${maker.maker}`}
          >
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="font-serif text-lg">{maker.maker}</h3>
              <span className="text-xl font-light tabular-nums">
                {money(maker.owed)}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground font-light">
              {maker.owed > 0
                ? `owed across ${maker.owedItems} ${maker.owedItems === 1 ? "item" : "items"}`
                : "nothing outstanding"}
              {maker.paid > 0 && ` · ${money(maker.paid)} settled`}
            </p>

            {maker.owedByStage.length > 0 && (
              <ul className="mt-3 space-y-1 border-t border-border/40 pt-3">
                {maker.owedByStage.map((stage) => (
                  <li
                    key={stage.stage}
                    className="flex justify-between gap-3 text-sm font-light"
                  >
                    <span className="text-muted-foreground">
                      {stageLabel(stage.stage)}
                    </span>
                    <span className="tabular-nums">{money(stage.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      {totalPaid > 0 && (
        <p
          className="mt-3 text-xs text-muted-foreground font-light"
          data-testid="production-pay-settled"
        >
          {money(totalPaid)} has already been settled, across every maker.
        </p>
      )}
    </div>
  );
}

/** A category whose five shares don't add up to a whole piece. Only ever
 * rendered when there is one — this is the sole surface it is visible on, and
 * an "all splits balance" line would just be noise the other 99% of the time. */
function UnbalancedNote({
  splits,
}: {
  splits: Array<{ category: string; total: number }>;
}) {
  if (splits.length === 0) return null;
  return (
    <div
      className="rounded-sm border border-border/60 p-4"
      data-testid="production-pay-unbalanced"
    >
      <h3 className="text-xs tracking-[0.14em] uppercase text-muted-foreground">
        Pay splits that don’t add up
      </h3>
      <p className="mt-1.5 text-sm text-muted-foreground font-light">
        The five stages of these categories don’t total 100% of the piece, so
        part of every item in them is owed to nobody.
      </p>
      <ul className="mt-2.5 space-y-1">
        {splits.map((split) => (
          <li
            key={split.category}
            className="flex justify-between gap-3 text-sm font-light"
          >
            <span>{split.category || "Untitled category"}</span>
            <span className="tabular-nums text-muted-foreground">
              {Math.round(split.total * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Items({
  items,
  itemCount,
}: {
  items: ProductionPayItem[];
  itemCount: number;
}) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;

  return (
    <div data-testid="production-pay-items">
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        className="flex w-full items-center gap-2 text-xs tracking-[0.14em] uppercase text-muted-foreground hover:text-foreground transition-colors"
        aria-expanded={open}
      >
        <ChevronDown
          className={`w-3.5 h-3.5 transition-transform ${open ? "" : "-rotate-90"}`}
          strokeWidth={1.5}
        />
        {itemCount} {itemCount === 1 ? "item" : "items"}
        {items.length < itemCount && ` · showing ${items.length}`}
      </button>

      {open && (
        <ul className="mt-3 space-y-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="rounded-sm border border-border/60 p-3.5"
              data-testid={`pay-item-${item.id}`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="font-serif">
                  {item.item || "Untitled item"}
                </span>
                <span className="text-sm tabular-nums text-muted-foreground">
                  {money(item.value)}
                  {item.units > 1 && ` · ${item.units} units`}
                </span>
              </div>

              {(item.category || item.product || item.orderStage) && (
                <p className="mt-0.5 text-xs text-muted-foreground font-light">
                  {[item.category, item.product, item.orderStage]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}

              <ul className="mt-2.5 space-y-1">
                {item.makers.map((maker) => (
                  <li
                    key={maker.maker}
                    className="flex justify-between gap-3 text-sm font-light"
                  >
                    <span>
                      {maker.maker}
                      <span className="text-muted-foreground">
                        {" · "}
                        {maker.stages
                          .map(
                            (stage) =>
                              `${stageLabel(stage.stage)}${stage.shared ? " (shared)" : ""}`,
                          )
                          .join(", ")}
                      </span>
                    </span>
                    <span className="tabular-nums whitespace-nowrap">
                      {money(maker.amount)}
                      <span className="text-muted-foreground">
                        {maker.paid ? " paid" : " owed"}
                      </span>
                    </span>
                  </li>
                ))}
                {item.unassigned > 0 && (
                  <li className="flex justify-between gap-3 text-sm font-light text-muted-foreground">
                    <span>Nobody assigned</span>
                    <span className="tabular-nums">
                      {money(item.unassigned)}
                    </span>
                  </li>
                )}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NeedsAttention({
  entries,
  total,
}: {
  entries: ProductionPayAttention[];
  total: number;
}) {
  if (entries.length === 0) return null;

  return (
    <div data-testid="production-pay-attention">
      <h3 className="text-xs tracking-[0.14em] uppercase text-muted-foreground">
        {total} {total === 1 ? "row needs" : "rows need"} filling in
      </h3>
      <p className="mt-1.5 text-sm text-muted-foreground font-light">
        Money on these rows is in none of the figures above.
      </p>
      <ul className="mt-2.5 space-y-1.5">
        {entries.map((entry) => (
          <li
            key={`${entry.id}-${entry.reason}`}
            className="text-sm font-light"
            data-testid={`pay-attention-${entry.id}`}
          >
            <span>{entry.item || "Untitled item"}</span>
            <span className="text-muted-foreground">
              {" — "}
              {attentionReason(entry)}
            </span>
          </li>
        ))}
      </ul>
      {entries.length < total && (
        <p className="mt-2 text-xs text-muted-foreground font-light">
          and {total - entries.length} more.
        </p>
      )}
    </div>
  );
}
