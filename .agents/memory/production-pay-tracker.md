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

## What is LIVE now (built + wired via the Notion API)

- **`Category Pay Splits`** — DB `65b9c8b9e12d409eb292f1210000966f`, data source
  `collection://6560e0a5-8304-4a8d-ae82-b6497ce2d030`. One row per category, a
  percent column per stage (`Consult & sketch` / `Sourcing` / `Cutting & pinning`
  / `Sewing` / `Detailing`), and a **`Total` formula** (sum of the five) = the
  100% guard. Seeded with the six rows above. Edit a % by typing; `Total` stays 100.
- **`Team`** — DB `5f903672e8684fea9e9c2eb7df88148b`, data source
  `collection://66ea699b-a07c-482b-a237-c02a12450a35`. Rows: Alexandra, Alayna.
  A roster for reporting/future; `Worked by` was **kept as a select** (adding a
  select option is enough to scale, and the By-worker grouping sums the single
  `Owed`), so the relation swap wasn't needed.
- **`production items`** (`collection://d5e3d564-…`): added a **`Pay Split`**
  relation → Category Pay Splits + 5 rollups (`Consult %`…`Detailing %`) + an
  **`Item value`** formula (`Sale price × Units`, Units→1 if blank). Dropped the
  `Alexandra/Alayna total owed` per-person rollups; `Total production owed` stays
  and sums the new `Owed`.
- **`pay distribution` Work Log** (`collection://66e784e8-…`): `Stage` reduced to
  the 5 canonical stages; added **`Category split`** relation → Category Pay
  Splits, the 5 `%` rollups off it, an **`Item value`** rollup (via `Production
  item`), a **`Share`** number, and an **`Applied %`** display formula. **`Owed
  ($)`** is now an **inline** formula: `Item value × (stage % picked from the
  category, honouring a manual Stage % override) × (Share, default 1)`. Dropped
  the `Rule` / `Rule Stage %` / `Effective Stage %` chain, the per-person
  `Alexandra/Alayna owed` formulas, and the entry's own `Sale price`.

  **Gotcha (load-bearing):** referencing a *stored* formula that wraps rollups in
  a multiplication throws "Type error with formula" in the Notion API. The stage-%
  selector had to be **inlined into `Owed`** (the standalone `Applied %` column is
  display-only for that reason). Keep `Owed` inline if you edit it.

Verified end-to-end with a throwaway $500 dress item: Sewing (full) → **$175**
(500×35%), Detailing (Share 0.5) → **$50** (500×20%×0.5).

## Remaining UI-only steps (the API can't do these)

1. **Generate-stages buttons** on `production items` (per-category buttons already
   exist: Dress/Soakers/Hair accessory/Hot tools bag). Configure each to add one
   Work Log row per **applicable** stage for that category, setting `Stage`,
   `Category split` = that category's Pay Splits row, `Worked by` (default), and
   `Share` = 1. A split stage = duplicate that row and set each `Share` to 0.5.
   (Buttons aren't API-creatable.)
2. **Payout view:** the existing **By worker** view on the Work Log groups on
   `Worked by` and sums `Owed` — that's each person's period total. Add a `Paid?`
   filter for a pay run.
3. **Delete the stale bits by hand** (the integration can't trash pages): any
   `ZZ TEST` rows; the old **`stage percentage split rules`** data source
   (`collection://bfe8eef7-…`, still holds the old %s as reference); the 8 legacy
   per-stage page templates on the Work Log; and optionally align the
   `production items.Category` select names to the six inventory categories
   (rename options in place to preserve values).

## Guardrails

- **Category list is the inventory taxonomy** — don't reintroduce a hand-kept pay
  category select; add categories in Product Categories and mirror the row here.
- **Σ = 100% per category** is the invariant the `Total` column exists to protect;
  a distribution that's wrong but still totals 100 is only catchable by the owner.
- **Free Notion plan:** everything here is rows/relations/rollups/formulas/views/
  buttons — none of it depends on the data-source query quota.
