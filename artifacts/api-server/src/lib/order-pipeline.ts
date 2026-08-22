// An order's *pipeline*: the production stages its service actually walks, in
// the order it walks them.
//
// Every custom order used to be shown the same eleven stages, because the live
// `Stage` option list was read once and attached to every order alike. That is
// right for a bespoke commission — the list *is* the commission's pipeline —
// and wrong for everything else: a repair has nothing sketched, sourced against
// a design, or pattern-drafted, so its customer was watching a timeline of
// stages their order would never reach.
//
// The fix keeps the one superset in Notion and lets `lib/service-catalog.ts`
// declare which of those stages each service walks (see `OrderServiceDef.pipeline`).
// This module is the single place that turns "which service" plus "what Notion
// says the stages are" into the ordered list every positional rule then runs
// against — delivered (`services/delivery.ts`), the measurement lock
// (`services/measurement-lock.ts`), the forward-only email gate
// (`services/order-notification.service.ts`) and the milestone spread
// (`services/schedule.service.ts`). None of those four changed: each already
// took the stage list as an argument, so resolving a narrower list here is what
// re-points all of them at the order's own pipeline at once.
//
// Pure and free of Notion I/O, so it is unit-testable and can be called from
// the repository as each page is mapped.

import { resolveStoredOrderService } from "./service-catalog.js";

/**
 * The ordered stages an order walks, selected from `liveStages` (the live
 * superset read from Notion). `service` is whatever the order stores — the
 * catalog `name` in practice, an `id` from a contract payload — resolved
 * tolerantly by `resolveStoredOrderService`.
 *
 * Degrades to `liveStages` — the widest, pre-pipeline behavior — in every case
 * where the narrower answer can't be trusted:
 *
 * - the service declares no pipeline (a bespoke commission, and the fallback an
 *   absent or retired `service` resolves to);
 * - none of the declared stages match a live option, which is what a wholesale
 *   Notion rename looks like. Serving a stage list we know to be stale beats
 *   serving an empty one: an empty list would report the order as *not*
 *   delivered forever (`orderDelivered` fails closed on `[]`), strand its
 *   milestones, and render a timeline with no steps in it.
 *
 * A *partial* match is honoured rather than rejected, so renaming one option
 * costs that service's timeline one step instead of collapsing it back to the
 * full commission list. Declared order wins over the live list's order — the
 * catalog is the authority on the sequence, since an alteration is fitted
 * before it is cut and the commission list has those the other way round.
 */
export function resolveOrderPipeline(
  service: string | undefined,
  liveStages: string[],
): string[] {
  const declared = resolveStoredOrderService(service).pipeline;
  if (!declared) return liveStages;

  const live = new Set(liveStages);
  const pipeline = declared.filter((stage) => live.has(stage));
  return pipeline.length > 0 ? pipeline : liveStages;
}
