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
// The fix keeps one superset in Notion — now widened with the stages a
// piece-in-hand service needs ("Piece Received", "Alteration/Adjustment",
// "Repair/Restoration") — and lets `lib/service-catalog.ts` declare which of it
// each service walks (see `OrderServiceDef.pipeline`). Because the superset
// holds stages no commission walks, the commission declares too: as an
// *exclusion*, so its timeline still adopts whatever else Notion says.
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
 * The ordered stages an order walks, resolved from `liveStages` (the live
 * superset read from Notion). `service` is whatever the order stores — the
 * catalog `name` in practice, an `id` from a contract payload — resolved
 * tolerantly by `resolveStoredOrderService`.
 *
 * Two shapes, per `ServicePipeline`:
 *
 * - **select** — the named stages, in the catalog's declared order, filtered to
 *   those the live list still has. A *partial* match is honoured rather than
 *   rejected, so renaming one option costs that service's timeline one step
 *   instead of collapsing it. Declared order wins over the live list's, because
 *   the catalog is the authority on the sequence.
 * - **exclude** — the live list in Notion's own order, minus the named stages.
 *   This is what keeps the commission timeline live-read: a stage the atelier
 *   adds, renames or reorders flows straight through, exactly as before
 *   pipelines existed.
 *
 * Degrades to `liveStages` — the widest, pre-pipeline behavior — whenever the
 * narrower answer can't be trusted: no declared pipeline (the floor for a
 * service that can't be resolved), or a selection matching nothing at all,
 * which is what a wholesale Notion rename looks like. Serving a stage list we
 * know to be stale beats serving an empty one: empty would report the order as
 * *not* delivered forever (`orderDelivered` fails closed on `[]`), strand its
 * milestones, and render a timeline with no steps in it. An exclusion that
 * removes everything degrades the same way, for the same reason.
 */
export function resolveOrderPipeline(
  service: string | undefined,
  liveStages: string[],
): string[] {
  const declared = resolveStoredOrderService(service).pipeline;
  if (!declared) return liveStages;

  const named = new Set(declared.stages);
  const pipeline =
    declared.kind === "select"
      ? declared.stages.filter((stage) => liveStages.includes(stage))
      : liveStages.filter((stage) => !named.has(stage));

  return pipeline.length > 0 ? [...pipeline] : liveStages;
}
