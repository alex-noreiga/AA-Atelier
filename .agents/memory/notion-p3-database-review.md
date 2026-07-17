# Notion "P3 — database re-evaluation" pass

A second dedup/simplification pass over the atelier's Notion workspace, following
`notion-p2-duplicates.md`. Same rule as before: the app reads/writes Notion by
**exact property name**, so adding a property is safe; renaming/deleting one the app
touches is not. Every finding below was cross-checked against what the deployed app
actually reads (re-verified in code this pass — see "App dependence" ).

## App dependence (re-verified against code, not just the P2 note)

- **Shop/products** reads only these `inventory` props (`products.schema.ts:12-22`):
  `Item Name`, `Category` (relation), `Listed Price`, `Status`, `Quantity Available`,
  `Listing Notes`, `Show on website`, `Website Photos`, `Website Group`,
  `Sizes Available`, `Sizes Offered`. It does **not** read `Priced Item`,
  `Costing Item`, or `Suggested Price`.
- **No costing DB is read anywhere** — zero code refs to `Priced Item`,
  `Suggested Price`, `Costing Item`, `Channel`, or the material-usage DB.
- **Invoices**: `Order → "Invoices" → line items (via line item "Invoice"
  back-relation)`; reads only line-item `Line Item`/`Line Type`/`Line Total`
  (`invoice.schema.ts:77-79`). `Costing Item`/`Unit Price` on line items and the
  direct `Order → Invoice Line Items` relation are unused.
- **Production Schedule**: app writes `Production Stage` (select) dynamically from the
  order's live `Stage` options + `Status="Not Started"` (`production-schedule.blocks.ts`).

## Applied this pass (via Notion MCP — additive / dead-only)

- **Removed dead relation** `materials inventory."Order Form Submissions"` — its target
  data source (`collection://c1f0f5eb…`) no longer resolves (404).
- **Wired `finances overview`** (was a relation-less manual ledger): added one-way
  relations `Shop Order` → Shop Orders, `Invoice` → invoices & payments,
  `Material Intake` → material intake. Rollups to auto-fill Income/Expense are the
  follow-up (M5). No existing data touched.

## Blocked from API — must be done in the Notion UI

**Costing consolidation (the big one — P2 #4 was started but never finished).**
There are still **two** costing tables:
- `costing` (unified, `Channel` = Custom/Production/Rhinestone; 9 rows) — the intended
  canonical table.
- `costing (production items)` (legacy; 5 rows = the same 5 production soakers) — now
  sitting under a **trashed ancestor** (its rows can't be edited via API), but still
  wired: `inventory.Priced Item` (5 rows) + its `Suggested Price` & `Material Usage
  Lines` rollups traverse it, and `material usage.Priced Item` (11 rows) feeds
  `Completed Product Count → Completed Quantity Used → materials inventory."Used in
  Completed Products" → "Stock on Hand"` (real internal stock logic).

The unified `costing` Production rows **already mirror** the legacy rows 1:1 (same
`Current Inventory Items`, same `Material Usage Lines`), so consolidating loses no data.
But it can't be finished via API because `material usage."Completed Product Count"` is
a **rollup of a rollup** (`Completed Inventory Quantity`), and the API refuses to
re-create that (`"Cannot create a rollup of a related rollup property"`). Do it in the
UI:

1. `material usage database`: re-point `Completed Product Count` rollup to go through
   `Costing Item` (→ unified) → unified `Completed Inventory Quantity` (sum). Then
   delete the `Priced Item` relation.
2. `inventory`: re-point `Suggested Price` rollup to `Costing Item` → unified
   `Final Price` (or `Suggested Price (Production)`), and `Material Usage Lines` rollup
   to `Costing Item` → unified `Material Usage Lines`. Then delete the `Priced Item`
   relation. (App reads none of these, so retiring instead of re-pointing is also OK.)
3. Empty the trash of the legacy `costing (production items)` table once nothing points
   at it.
4. Update `Pricing Settings` field descriptions (still name "costing (custom orders)/
   (production items)").

## Remaining manual checklist (from the review; user-owned)

- **Production progress duplication** — `Order Tracking Pipeline.Stage` (app-facing) vs
  `production items` 24 per-stage `done/by/date` columns vs `Stage work entries` (pay).
  Decision: **`Stage work entries` is canonical**; drop the 24 per-stage columns on
  `production items` (keep `Overall status` + pay rollups). Reconcile the stage-name
  vocabularies (Pipeline has Pattern Design/Fitting; pay side has Packaging/Sourcing).
- **Costing formulas** — one table now holds 3 labor inputs + 3 profit models + ~20
  channel-specific formulas; hide channel-irrelevant fields behind per-channel
  templates/views, or reconcile to one labor unit + one margin model.
- **Supplier** (P2 #8 still open) — `material intake` has both free-text `Supplier` and
  the `Supplier Directory` relation; migrate the text into the relation, convert
  `Supplier directory."Materials tracked"` (manual number) to a rollup, drop the text.
- **finances overview rollups (M5)** — add rollup/formula columns summarizing the new
  Shop Order / Invoice / Material Intake relations into Income/Expense.
- **Production Schedule cron** — only 3 rows, all "Not Started", `Production Stage`
  degenerate to one option; verify the milestone cron fires / `Milestones Generated`
  flags before relying on the Timeline/Calendar views.
- **(optional)** prune the redundant direct `Order → Invoice Line Items` relation.

## Data snapshot at time of pass
~20 databases; Order Tracking + costing(9) + inventory(15, 5 legacy-linked) +
production items(1) + Production Schedule(3). Low volume — much of the machinery is
scaffolding ahead of usage.
