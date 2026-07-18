# Production pay tracker — worker pay by item category

## What / why

The atelier pays each team member (Alexandra / Alayna) a **share of an item's
sale value** for the production stages they personally work. Different item
**categories** split that value across stages differently (a soaker is just
cutting + sewing; a dress spans five stages). This note captures the model, the
locked percentages, what's now live in Notion, and the remaining UI-only steps.
It is a **Notion-side** system under the `finances` page — there is no app/repo
code for it (the app never reads or writes pay).

## Diagnosis (why the old setup hurt)

The pre-existing `production pay tracker` (Notion DB titled **"pay distribution"**,
`collection://66e784e8-…` = *Stage work entries* + `collection://bfe8eef7-…` =
*stage percentage split rules*, plus *production items* `collection://d5e3d564-…`)
had four pains that reduce to two causes:

- **A — pay inputs were re-typed, not derived:** each entry hand-linked a `Rule`
  row and hand-typed a `Sale price`. → manual entry, wrong %s, sale-price drift
  from the invoice. Live example found: the old split table summed **Dresses to
  105%** (a duplicate consultation row) and the non-dress categories carried
  identical placeholder splits.
- **B — people were modeled as columns:** `Alexandra owed ($)` / `Alayna owed ($)`
  formulas (and matching rollups on production items). → won't scale past two.

## Locked distribution (source of truth)

Categories **follow the inventory taxonomy** (Product Categories
`collection://3868b1d0-…`: Ready to Wear · Men's Costume · Dresses · Hair
Accessory · Skate Soakers · Other) so pay categories can't diverge from the
catalog. Canonical stages: **Consultation & sketching · Sourcing materials ·
Cutting & pinning · Sewing/construction · Rhinestoning/Detailing** (Assembly &
Packaging retired — no category pays them; dress packaging folds into detailing +
consult).

| Category | Consult&sketch | Sourcing | Cutting&pin | Sewing | Detailing | Σ |
|---|---|---|---|---|---|---|
| Dresses | 15 | 10 | 20 | 35 | 20 | 100 |
| Men's Costume | 15 | 10 | 20 | 35 | 20 | 100 |
| Ready to Wear | 15 | 10 | 20 | 35 | 20 | 100 |
| Skate Soakers | 0 | 0 | 30 | 70 | 0 | 100 |
| Hair Accessory | 0 | 0 | 30 | 40 | 30 | 100 |
| Other / bags | 0 | 0 | 30 | 40 | 30 | 100 |

**Invariants:** every category **sums to 100%**; a 0 means the stage doesn't apply
(the generator emits no entry for it). Pay formula:
**`Owed = item sale price × units × stage % × share`**, where `share` = 1 normally
and 0.5 on each of two rows when a single stage is split between both workers.

## What is LIVE now (built via the Notion API)

- **`Category Pay Splits`** — DB `65b9c8b9e12d409eb292f1210000966f`, data source
  `collection://6560e0a5-8304-4a8d-ae82-b6497ce2d030`. One row per category, a
  percent column per stage, and a **`Total` formula** (sum of the five) = the
  100% guard. Seeded with the six rows above. Edit a % by typing in a cell; watch
  `Total` stays 100.
- **`Team`** — DB `5f903672e8684fea9e9c2eb7df88148b`, data source
  `collection://66ea699b-a07c-482b-a237-c02a12450a35`. Rows: Alexandra, Alayna
  (`Active` checkbox). Relation target for the Work Log's `Worked by`; adding a
  worker = adding a row (no formula edits).

## Remaining UI-only runbook (rewiring the live tracker — do by hand)

Deliberately NOT auto-applied: the "pay distribution" DB is multi-source with
formulas that decide real pay + saved views, and buttons can't be created via the
API at all. Apply in order; nothing old is deleted until the new path verifies.

1. **Production items** (`collection://d5e3d564-…`): add a relation **Pay Split →
   Category Pay Splits** and set each item to its category's row; add 5 rollups
   (Consult% / Sourcing% / Cutting% / Sewing% / Detailing%, "show original").
   Make **`Sale price`** a rollup from the invoice (Order → *invoices & payments*
   `collection://d64a9c2f-…`) instead of hand-typed. Align its `Category` select
   to the six inventory categories.
2. **Work Log** (`collection://66e784e8-…`): point **`Worked by`** at a relation →
   Team; add a **`Share`** number (default 1); keep/repurpose the existing
   **`Stage %`** number as the per-row stage share the button stamps in. Replace
   the **`Owed ($)`** formula with `item Sale price × Units × Stage % × Share`
   (Sale price + Units come via the `Production item` relation or are copied in by
   the button). Add a **By worker** group on the Team relation.
3. **Generate-stages button** (on production items, UI-only): make it emit one
   Work Log row per **applicable** stage for the item's category (stage %>0 → soaker
   = 2 rows, dress = 5), setting `Stage`, `Worked by` (default), `Share` = 1, and
   `Stage %` = the item's matching rollup for that stage. Splitting a stage = duplicate
   that row and set each `Share` to 0.5. (Because the button snapshots the % at
   generation, later edits to `Category Pay Splits` don't retroactively change
   already-recorded pay — desirable for a pay ledger.)
4. **Retire after verify:** the old `stage percentage split rules` data source
   (`collection://bfe8eef7-…`) and the `Rule` / `Rule Stage %` / `Effective Stage
   %` chain; the `Alexandra owed ($)` / `Alayna owed ($)` columns (replaced by one
   `Owed` grouped by worker); the `Applies to` select.

**Per-person payout** = group the Work Log **By worker** for a period, or roll
`Owed` up onto each Team row.

## Guardrails

- **Category list is the inventory taxonomy** — don't reintroduce a hand-kept pay
  category select; add categories in Product Categories and mirror the row here.
- **Σ = 100% per category** is the invariant the `Total` column exists to protect;
  a distribution that's wrong but still totals 100 is only catchable by the owner.
- **Free Notion plan:** everything here is rows/relations/rollups/formulas/views/
  buttons — none of it depends on the data-source query quota.
