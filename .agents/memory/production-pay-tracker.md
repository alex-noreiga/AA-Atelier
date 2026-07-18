# Production pay tracker — worker pay by item category

## What / why

The atelier pays each team member (Alexandra / Alayna) a **share of an item's
sale value** for the production stages they personally work. Different item
**categories** split that value across stages differently (a soaker is just
cutting + sewing; a dress spans five stages). This is a **Notion-side** system
under the `finances` page — there is no app/repo code for it (the app never reads
or writes pay).

## Final design (item-level — no Work Log, no buttons)

Pay is computed **entirely on the `production items` row**. There is no separate
per-stage log and no "Generate stages" buttons — both were removed. One row per
item; you fill in who did each stage; the two owed formulas compute.

- **`Category Pay Splits`** — DB `65b9c8b9e12d409eb292f1210000966f`, data source
  `collection://6560e0a5-8304-4a8d-ae82-b6497ce2d030`. One row per category, a
  percent column per stage (`Consult & sketch` / `Sourcing` / `Cutting & pinning`
  / `Sewing` / `Detailing`), and a **`Total`** formula (=100% guard). Six rows:
  Dresses / Men's Costume / Ready to Wear (15/10/20/35/20), Skate Soakers
  (0/0/30/70/0), Hair Accessory & Other (0/0/30/40/30). Edit a % by typing;
  `Total` must stay 100. **Categories mirror the inventory Product Categories** —
  don't reintroduce a hand-kept pay-category list.
- **`production items`** (`collection://d5e3d564-…`) — the single working table:
  - `Pay Split` relation → Category Pay Splits (set per item to its category row),
    with 5 rollups `Consult %`…`Detailing %` pulling that category's percentages.
  - Per-stage assignee selects, each **Alexandra / Alayna / Split**:
    `Consult & sketch by`, `Sourcing materials by`, `Cutting & pinning fabric by`,
    `Sewing by`, `Detailing by`. "Split" = both worked it, 50/50.
  - `Sale price`, `Units`.
  - **`Alexandra owed`** / **`Alayna owed`** formulas:
    `Sale price × Units × Σ over stages (stage % × factor)`, where factor = 1 if
    that stage's "…by" is that person, 0.5 if "Split", else 0. Inapplicable stages
    contribute 0 (their category % is 0).
  - `Team` DB (`5f903672…`, Alexandra/Alayna) exists as a roster; not required by
    the calc (assignees are selects). A third worker = add a select option to each
    "…by" + a third owed column.

**Payout:** a view of `production items` filtered by `Paid?`, summing the
`Alexandra owed` / `Alayna owed` columns (Notion column sum). Per-stage `…done`
/ `…completed date` fields remain for production tracking.

**Trade-off accepted:** only *even* 2-way splits (Split = 50/50) between the two
of them, and per-person owed as columns. Chosen for simplicity in a two-person
shop; uneven splits / 3+ workers would need the per-stage-row model instead.

Verified end-to-end on the Knight dress ($500, Units 1): Consult+Sourcing =
Alexandra, Cutting+Detailing = Alayna, Sewing = Split → **Alexandra $212.50**
(15+10+17.5%), **Alayna $287.50** (20+20+17.5%), summing to the full $500.

## Load-bearing Notion-formula gotchas (hit repeatedly building this)

1. **You cannot reference a *stored* formula property inside a multiplication via
   the API** — `prop("SomeFormula") * x` throws "Type error with formula". Inline
   the computation instead (that's why owed uses `Sale price × Units × …` directly,
   not the `Item value` formula, and why the deposit/stage-% logic is inlined).
2. **An `if` that *returns* a rollup** taints the type when combined; make the `if`
   return a plain **number factor** (1 / 0.5 / 0) and multiply the rollup by it.
3. **Renaming a column and changing its options in the same DDL batch** creates a
   duplicate `… 1` column — do renames in a separate call from `ALTER … SET`.

## History / cleanup

An earlier iteration wired a **Work Log** ("pay distribution" DB
`collection://66e784e8-…`) with a `Category split` relation, per-stage rows, and
an inline `Owed` formula — then we simplified to the item-level model above and
**removed the buttons**. That Work Log is now unused; the old
`stage percentage split rules` data source (`collection://bfe8eef7-…`) still holds
the original %s as reference. **Delete by hand** (the API can't trash pages): any
`ZZ TEST` rows, the unused Work Log / old split-rules DB if you don't want them,
and optionally align the `production items.Category` option names to the six
inventory categories (rename in place to keep values). Free Notion plan: all of
this is rows/relations/rollups/formulas/views — no query-quota dependency.
