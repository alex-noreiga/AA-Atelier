---
name: Custom Orders — "Stage" vs "Fulfilment" boundary
description: The two status columns on Custom Orders (11-step production Stage vs 4-step shipping Fulfilment) have a deliberate split; the app reads Stage only, never Fulfilment.
---

# Custom Orders: "Stage" vs "Fulfilment" — the boundary

The `Custom Orders` database carries two status-ish columns that overlap at the
finish, which used to invite "done in one place, in-progress in the other":

- **`Stage`** (Notion **status**, 11 options): the _making_ workflow —
  Consultation → Sketching → Sourcing → Pattern Design → Cutting/Pinning →
  Sewing/Construction → Assembly → Fitting → Rhinestoning/Detailing → Ready for
  delivery/pickup → **Delivered**.
- **`Fulfilment`** (Notion **select**, 4 options): the _shipping/handoff_
  logistics — To pack → Packed → Shipped → Delivered/Picked up.

## The decision (Phase-1 housekeeping)

**Keep both; redefine the boundary rather than fold one in.**

- **`Stage` owns "is it made?"** It is the single source of truth for order
  progress and completion. It drives the customer tracking timeline, the
  production-schedule milestones, and the review gate.
- **`Fulfilment` owns "how did it get to the customer?"** — the physical shipping
  sub-workflow, and only becomes meaningful once `Stage` reaches "Ready for
  delivery/pickup". It drives the atelier's "🚚 To Ship" board.

> **Update (Aug 2026):** the app now **reads** `Fulfilment` — but only as
> advisory copy about the shipping leg on the tracking page, never as a
> completion signal, and the server drops it once the order is delivered so the
> two can't contradict each other at the finish. See
> `order-fulfilment-tracking.md`. Everything below still holds; only the
> "referenced nowhere in the codebase" sentence is out of date.

The one apparent overlap — `Stage = "Delivered"` vs `Fulfilment = "Delivered/
Picked up"` — is intentional at two different granularities: `Stage."Delivered"`
means the _order_ is complete (the customer-facing milestone), while
`Fulfilment."Delivered/Picked up"` means the _shipping leg_ concluded. **Rule:
never treat `Fulfilment` as a completion signal in code — `Stage` is authoritative
for "done."**

## Why this needed no code change

The app's "delivered" test is positional off the **live Stage list**, not a stage
name and not `Fulfilment`: `orderDelivered(currentStage, stages)` returns true
only when the current stage is the _last_ in the list (`services/delivery.ts`;
the same rule the production schedule uses). The Custom Orders `Fulfilment` select
was referenced **nowhere** in the codebase when this was written; it is now read
only for the tracking page's fulfilment panel (above), and by nothing that
decides whether an order is finished. So keeping
`Stage` ending in "Delivered" preserves every app behavior; the boundary above is
a workflow convention for the atelier, enforced by "don't read Fulfilment in code."

## If the atelier ever wants to change it

- Renaming/reordering `Stage` options is safe — the app reads the list live and
  keys "delivered" off _position_, not the name (see `notion-status-filters.md`).
- Dropping "Delivered" from `Stage` (so the last option becomes "Ready for
  delivery/pickup") **would** move the review/milestone "delivered" trigger a step
  earlier — that's a behavior change, not just a rename. Don't do it without
  intending it.
