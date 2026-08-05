# Costing engine standardization (2026-08)

Finished the roadmap card **"One costing engine, not three"** — the three parallel
engines were already merged into one `costing` Notion database with a `Channel`
select (Custom / Production / Rhinestone); this pass did the card's remaining work,
**standardizing the labor unit and profit model across channels**. Workspace-only
(no repo code changed) — the app reads only the resolved `Suggested Price` /
`Labor Cost` numbers, so the engine internals are app-safe to reshape as long as
those two property names stay + stay number-valued (see `invoice-building.md`).

## What was wrong

- **Three `Pricing Settings` rows**, not the "one row" the earlier consolidation
  claimed: *standard production* ($5/hr, 100% margin, 6.5% fee), *standard custom*
  ($5, 100%, 0%), *extensive custom* ($10, 100%, 0%). Each costing row related to one
  and rolled up its rate/margin/fee.
- **Labor rate split $5 vs $10** by effort tier — redundant, since effort already
  lives in `Labor Hours` (Stateside 72h, Toothless 36h).
- **Two margin sources**: a per-row `Profit Margin` field (Toothless = 25%) that
  *overrode* the settings default (100%) via `if(empty(Profit Margin), settings, Profit Margin)`.
- **Selling fee hard-branched to Production** inside `Suggested Price`
  (`if(Channel == "Production", 1 − fee, 1)`).

## Decisions (from the atelier)

Allow price changes · **one uniform rate $5/hr** · **one uniform margin 100%**,
per-row overrides removed · **selling fees settings-driven for all channels**
(Production 6.5%, Custom 0%), drop the Production branch.

## What was changed in Notion

1. **`Suggested Price` rewritten** (costing data source `1d0f258c-…`):
   `round((Material Cost + Labor Hours × Default Hourly Rate (from settings) +
   Packaging Cost (from usage)) × (1 + Default Profit Margin (from settings)) /
   (1 − Default Selling Fees % (from settings)) × 100) / 100`.
   Channel-agnostic; reads margin + fee from the settings rollups. Price-neutral for
   existing rows (Custom fee 0% ⇒ ÷1; Production keeps 6.5%) **except** the two
   intended moves below.
2. **`Profit` analytic rewritten** off the dropped field:
   `(inlined break-even) × Default Profit Margin (from settings)`.
3. **Per-row `Profit Margin` column dropped.**
4. **Pricing Settings collapsed 3 → 2**, differing only in the fee:
   `Custom / Direct` ($5 / 100% / 0%, was *standard custom* `3a2da6fac63880ef97fbe1e0561b7124`)
   and `Production / Marketplace` ($5 / 100% / 6.5%, was *standard production*
   `39fda6fac63880878ed4dcbfbabe30d7`). The *extensive custom* row
   (`3a2da6fac63880a69dbbcbf650c4ec2f`, $10) was renamed "⚠️ RETIRED …" for the
   atelier to delete in the UI (the API can't hard-delete a page).
5. **Re-pointed** two costing rows: *Stateside Dress* extensive→Custom/Direct (its
   labor $10→$5), *The Truth Dress* production→Custom/Direct + set Channel = Custom
   (it had no Channel; kept price-neutral — old formula ignored fees for non-Production).

Intended price moves: **Stateside** labor drops ($10→$5/hr), **Toothless** margin
rises (25%→100%). Everything else price-neutral. Already-generated invoices are
unaffected (the line-item generator is idempotent — skips invoices that already have
lines), so only new quotes reprice.

## Load-bearing gotchas (Notion `update-data-source` DDL)

- **Cannot reference another formula property in a formula.** `prop("Break Even
  Price")` / `prop("Labor Cost")` → `400 "Type error with formula"`, even though the
  Notion UI accepts it. Rollups + numbers reference fine. That's why `Suggested
  Price` and `Profit` **inline** the break-even base instead of referencing the
  `Break Even Price` column (a mild DRY cost — break-even logic now lives in 3
  places; collapse them back to `prop("Break Even Price")` if editing in the UI).
- **`round(x, 2)` (2-arg) is rejected** by the DDL parser — use `round(x*100)/100`.
- **Property descriptions can't be set via DDL** — `Suggested Price`'s stale
  "Break-even price + labor cost" description was cleared to blank by the rewrite;
  re-describe in the UI if wanted.

## Manual follow-ups for the atelier (UI)

- Delete the "⚠️ RETIRED — merged into Custom / Direct" Pricing Settings row.
- Optionally remove the unused `Rhinestone` `Channel` option (no rows use it).
- Eyeball `Suggested Price` on a Production row (unchanged), Stateside (down),
  Toothless (up) — the API can't read computed formula values.
