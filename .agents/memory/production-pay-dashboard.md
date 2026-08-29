# Production pay on the studio dashboard

Roadmap card ① — "Work distribution records who did the consult, sourcing,
cutting, sewing and detailing on each item, and derives what each of them is
owed from the category pay splits. The dashboard reports revenue and what
customers owe, but nothing about what the studio owes its own people."

Shipped August 2026. `GET /api/studio/production-pay`, rendered at
`/studio/pay`.

## What it joins

Two Notion databases the atelier has kept by hand since before the app existed,
neither of which the app had ever read.

**`work distribution`** (`NOTION_WORK_DISTRIBUTION_DATABASE_ID`), under
_fulfillment_ — one row per physical item made:

| Property                      | Type              | Read as                                   |
| ----------------------------- | ----------------- | ----------------------------------------- |
| `Production item`             | title             | the item's name                           |
| `Product`                     | rich_text         | size / colour / variation                 |
| `Sale price`                  | number            | per item; blank ⇒ **unknown**, never zero |
| `Units`                       | number            | how many; blank ⇒ **one**, never zero     |
| `Category`                    | relation → splits | the join key                              |
| `Order`                       | relation → orders | the commission, when there is one         |
| `Order Stage`                 | rollup (status)   | shown; **never** a pay gate               |
| `Consult & sketch by`         | select            | who did it                                |
| `Sourcing materials by`       | select            | who did it                                |
| `Cutting & pinning fabric by` | select            | who did it                                |
| `Sewing by`                   | select            | who did it                                |
| `Detailing by`                | select            | who did it                                |
| `Paid <name>`                 | checkbox          | settlement, **read by prefix**            |
| `Notes`                       | rich_text         | the atelier's own note                    |

The five selects each offer `Alexandra` / `Alayna` / `Split`.

**`Category Pay Splits`** (`NOTION_PAY_SPLITS_DATABASE_ID`), under _finances_ —
one row per product category, five percent-formatted numbers. The live values
as of shipping:

| Category       | Consult | Sourcing | Cutting | Sewing | Detailing |
| -------------- | ------- | -------- | ------- | ------ | --------- |
| Dress          | 15%     | 10%      | 20%     | 35%    | 20%       |
| Ready to Wear  | 15%     | 10%      | 20%     | 35%    | 20%       |
| Men's Costume  | 15%     | 10%      | 20%     | 35%    | 20%       |
| Skate Soakers  | 0       | 0        | 30%     | 70%    | 0         |
| Bag            | 0       | 0        | 30%     | 40%    | 30%       |
| Hair Accessory | 0       | 0        | 30%     | 40%    | 30%       |
| Other          | 0       | 0        | 30%     | 40%    | 30%       |

All seven total 100%, so the five stage shares partition the whole sale price:
production pay IS the item's value, divided by who did the work. That is the
owner-operator model the two of them run on, not an oversight.

## The decision that shaped the whole feature

**Notion already carries `Alexandra owed` and `Alayna owed` formulas doing this
multiplication, and they are deliberately NOT read.**

Reading them would have been much less code and would exactly match what the
atelier sees in Notion — the argument that made the consignment reader read
`Your Payout` off its formula rather than re-deriving it. It loses here on
three counts:

1. **Those property names hardcode today's two makers.** A third maker would
   need a new formula, a new `Paid <name>` column, a new `<name> owed` column
   **and** a code change before the app could report a penny of their pay.
   Reading the assignee out of each select instead makes the roster data: a
   name the atelier types into a select is a person the dashboard reports on.
2. **A per-person total can't be broken down.** `Alexandra owed: $250` is
   already readable in Notion. What the panel adds — and what makes it worth
   opening — is that $175 of it is sewing and $75 is the consult. A formula
   producing one number per person structurally cannot say that.
3. **The formula bodies are not readable through the API.** The MCP surface
   returns a `formulaCode://` handle it will not fetch, so the semantics of
   `Split` in that formula could not be verified even if we wanted to match it.

What IS read rather than invented is the thing that is genuinely a commercial
term: the **pay splits**. A rate held in code would silently keep paying last
season's split. Same division of labour as consignment, arrived at from the
other side — there the rate lives in a formula so the money is read and the
units derived; here the rate is its own database, so the rate is read and the
multiplication is ours.

**The standing cost:** the owed arithmetic now exists in Notion's two formulas
AND in `services/production-pay.service.ts`. **Change one and change the
other**, exactly like `classifyMaterials` against the `Restock Alert` formula.
Nothing enforces it.

## Rules worth knowing

- **`Split` divides the stage evenly across the whole roster.** With today's two
  makers that is the plain 50/50 everybody means by it. Were a third added, a
  `Split` stage would divide three ways — stated rather than guessed, because
  the alternative (picking two names out of the roster) would be the app
  deciding who worked on a piece. **If the atelier means "the two of us" and a
  third maker joins, this needs revisiting.**
- **A blank `Units` is ONE, a blank `Sale price` is UNKNOWN.** The row is an
  item, so a missing count is one piece — folding it to zero would value real
  work at nothing. There is no such default for a price, so an unpriced row is
  reported in `needsAttention` rather than guessed at.
- **A maker with no `Paid <name>` column reads as UNPAID.** The safe direction:
  the panel may overstate what is owed, which is visible, never hide it, which
  is not.
- **Owed means "not ticked paid", full stop.** The order's stage rides along so
  the atelier can see what they are settling on, but the app never gates pay on
  it. Whether a half-sewn dress has earned its pay is their judgement, recorded
  by ticking the box — inventing an earned-at-delivery rule would contradict a
  table they already keep.
- **Nothing uncomputable is dropped.** No sale price, no category, or a stage
  nobody is assigned to ⇒ a named `needsAttention` row with the reason. A
  payroll figure that reads as complete while it is short is the worst way for
  this to be wrong.
- **The roster is read from the live select OPTIONS**, so a maker with no work
  still gets a nought row and the panel reads as the payroll rather than as a
  list of who happens to be owed. That read is **best-effort**:
  `summarizeProductionPay` widens whatever roster it is handed with the names
  the rows themselves carry, so a failed schema read costs a nought row and
  never anybody's pay.
- **A category whose five shares don't total 100% is flagged.** This panel is
  the only surface it is visible on — in Notion a mistyped split looks exactly
  like a correct one, and silently underpays whoever did the missing stage.

## Why its own section, and its own endpoint

`/studio/pay` is a section in `STUDIO_SECTIONS`, so only opening it runs the
read. Folding these two bounded full-database scans into `GET /studio/analytics`
would make everyone opening the **figures** pay for a payroll question they
didn't ask — which is the exact cost "The dashboard's sections" was built to
remove.

## Atelier setup

Two env vars, and share the Notion integration with both databases:

```
NOTION_WORK_DISTRIBUTION_DATABASE_ID = c853ea2b-b00d-48c4-bd82-21439e7444dc
NOTION_PAY_SPLITS_DATABASE_ID        = 65b9c8b9-e12d-409e-b292-f1210000966f
```

Nothing to add in Notion — every property read already exists. Unset ⇒ the
panel says **which** database is missing, rather than showing nought owed
(which reads as "everyone has been paid"). A 404 ⇒ `unreachable`, with the
sharing fix in the panel.

Two data-entry habits make it useful: give every row a **`Sale price`** and a
**`Category`**, and fill in the five `… by` selects as the work is done. The
existing **"Needs stage entries"** Notion view (filtered on the atelier's own
`Needs attention` formula) is the same idea from the other side.

## Known limits

- **Both makers see each other's pay.** The panel is behind `requireStaff` like
  the rest of the studio surface, and both makers are staff. Fine for a
  two-person owner-operator studio who already share the Notion database; it
  would need per-person scoping before anyone else joined the allowlist.
- **Read-only.** Ticking `Paid <name>` is still done in Notion. A "mark
  settled" button would be the natural follow-up and would need the app's first
  write to this database.
- **No period scoping.** The figures are the whole book, not "this month".
  There is no date on a work-distribution row to scope by — the order's created
  time would be the nearest thing, and would misattribute anything typed up
  late (the same trap `orderedOn` documents for shop orders).
