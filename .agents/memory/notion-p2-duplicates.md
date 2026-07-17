# Notion "P2 — duplicate logic" cleanup

A pass over the atelier's Notion workspace to remove duplicated data/logic across
databases. Each item below records: what was verified about the **deployed app's**
dependence on the data (so nothing load-bearing gets pruned), what was **applied**
in this pass, and the **remaining manual steps** (Notion formula edits and property-
type conversions can't be done through the API — those are UI jobs).

The app reads/writes Notion by **exact property name** (see `notion-status-filters.md`
and the `lib/notion/*.blocks.ts` / `*.schema.ts` constants). So: adding a property is
always safe; renaming or deleting a property the app touches is not.

## What the app actually depends on (verified against the codebase)

- **Prices:** the shop reads **only** `inventory."Listed Price"`
  (`products.schema.ts` `PRODUCT_PRICE_PROPERTY`), consumed by
  `checkout.service.ts`. It reads **no** `costing.*` or `production items."Sale price"`.
- **Customer identity:** `Orders."Email"` is **read back** by the measurement-change
  identity gate (`measurement-change.service.ts` via `orders.schema.ts`
  `extractOrderEmail`) — do not remove it. `Shop Orders` and `Website Contact
  Messages` customer name/email are **write-only** (never read back).
- **Invoicing:** the app follows exactly one path — `Order → "Invoices" → (line items
  via their own "Invoice" back-relation)` (`invoice.repository.ts` /
  `invoice.service.ts`). It never reads a direct `Order → Invoice Line Items` relation.
- **Sizes:** the shop reads **both** `inventory."Sizes Offered"` and `"Sizes
  Available"`, with distinct meaning (`products.schema.ts` `computeSizeOptions`):
  Offered = which size bands appear in the picker; Available = the per-band in-stock
  flag (drives the sold-out + back-in-stock UX). Neither is redundant.

## Item-by-item

### #4 — Three parallel costing engines  (internal)
`costing (custom orders)` (labor **hours**, Profit Margin), `costing (production
items)` (labor **minutes**, Selling Fees %), `Rhinestone Cost Calculator` (labor
hours, Markup %) all recompute labor → total cost → suggested price with different
units + profit models. **App-safe to unify** — the app reads none of them (the
custom→invoice link is via `costing (custom).Invoice Line Items`, which the app also
never reads; keep it for the atelier's line-item generation).
- **Applied:** none (a full unify is a formula rebuild — UI only).
- **Manual:** either unify into one `costing` DB with a `Channel` select
  (Custom / Production / Rhinestone) + one labor unit (hours) + one profit model, or
  at minimum standardize the labor unit + profit model across the three. Keep
  `costing (custom) → Invoice Line Items` intact.

### #5 — Pricing Settings now feeds the costing tables  (internal) — PARTLY APPLIED
`Pricing Settings` (single-row: Custom/Production Hourly Rate, Default Profit Margin,
Default Selling Fees %) was wired to nothing; each costing table had its own
hand-typed `Hourly Rate` etc.
- **Applied:** added a one-way `Pricing Settings` **relation** + **rollups** to both
  costing tables:
  - `costing (custom orders)`: `Default Hourly Rate (from settings)` (← Custom Hourly
    Rate), `Default Profit Margin (from settings)`.
  - `costing (production items)`: `Default Hourly Rate (from settings)` (← Production
    Hourly Rate), `Default Selling Fees % (from settings)`.
- **Manual (UI):** (1) link each costing row to the single Pricing Settings row via
  the new relation; (2) rewrite each costing table's cost **formula** to consume the
  rollup (keep the manual `Hourly Rate`/`Profit Margin`/`Selling Fees %` field as an
  optional per-row override, e.g. `if(empty(prop("Hourly Rate")), prop("Default
  Hourly Rate (from settings)"), prop("Hourly Rate"))`). Rhinestone uses `Markup %`,
  which Pricing Settings doesn't hold, so it's intentionally not wired.

### #6 — Four "price" fields  (🔴 shop-backed, but safe)
`costing.Suggested Price` (formula) vs `costing.Etsy Listing Price` (manual) vs
`inventory.Listed Price` (manual) vs `production items.Sale price` (manual).
- **Authoritative:** `inventory.Listed Price` — the only price the shop reads. Keep.
  `inventory` already rolls up `costing (production items).Suggested Price` (via the
  `Priced Item` relation) as an advisory reference — keep that too.
- **Manual:** `costing.Etsy Listing Price` is an orphan (nothing reads it) → safe to
  delete. `production items.Sale price` is **not** an orphan — it feeds the pay
  tracker's `Owed` formula (#10) — don't delete; ideally roll it from
  `inventory.Listed Price` so the sale price isn't hand-copied.

### #7 — Customer identity unified to the Client CRM  (🔴 app-backed) — APPLIED (code + schema)
CRM is canonical; only Order Tracking linked to it. Shop Orders + Website Contact
Messages re-typed name/email as free text with no CRM link.
- **Applied (Notion):** added a `Client` **relation → Client CRM** on **Shop Orders**
  (dual; CRM gains a `Shop Orders` back-relation) and on **Website Contact Messages**
  (dual; CRM gains a `Contact Messages` back-relation).
- **Applied (code):** the app now upserts the Client CRM by email (dedupe) and writes
  the `Client` relation on every customer touchpoint, mirroring the existing order
  flow:
  - Shop orders: `checkout.service.ts` `recordPaidOrder` (buyer → **Active**).
  - Contact form: `contact.service.ts` (enquirer → **Lead**).
  - Back-in-stock: `notify.service.ts` (→ **Lead**, CRM row named by email).
  - Measurement change: `measurement-change.service.ts` (→ **Active**; usually an
    existing client).
  - `clients.repository.ts` `upsertClientByEmail` gained an optional `status`
    (default Active) and names a new client by its email when no name is given.
    All calls are **best-effort** (a CRM failure never fails the request) and no-op
    when `NOTION_CLIENT_CRM_DATABASE_ID` is unset. New-client status is only set on
    creation; an existing client's status is left as the atelier maintains it.
  Shared property name: `CONTACT_CLIENT_PROPERTY = "Client"` (contact.blocks.ts,
  shared by the three contact writers); `SHOP_ORDER_CLIENT_PROPERTY = "Client"`.
- **Do NOT remove** the free-text email fields: `Orders.Email` is read back (identity
  gate); the Shop Orders / Contact Messages emails are the only customer record on a
  row until the CRM link is populated, and removing a write target would need the
  corresponding code write removed too.

### #8 — Supplier unified to the directory relation  (internal) — PARTLY APPLIED
Supplier was recorded three ways: free text on `materials inventory.Supplier`, free
text on `material intake.Supplier`, plus a real `material intake → Supplier directory`
relation.
- **Applied:** added a dual `materials inventory → Supplier directory` **relation**
  ("Supplier Directory" here; reverse "Materials inventory" on the directory).
- **Manual (UI):** (1) migrate the typed `Supplier` names on both `materials
  inventory` and `material intake` into the relation; (2) convert `Supplier
  directory.Materials tracked` (manual number) into a **rollup** = count of the new
  `Materials inventory` reverse relation; (3) delete the two free-text `Supplier`
  fields once migrated.

### #9 — Redundant invoicing relations  (🔴 app-backed) — DOCUMENT ONLY
`Order → Invoice Line Items` (direct) and `Order → Invoices → Line Items` reach the
same rows.
- **Canonical (what the code follows):** `Order → "Invoices" → invoice → line items
  via their own "Invoice" back-relation`. **Leave the relations as-is** — the value of
  removing the alternate path is low and the risk (pruning the wrong one) is real.
  Just don't build new logic on the direct `Order → Invoice Line Items` path.

### #10 — Pay tracker copies + per-stage overrides  (internal)
`production pay tracker` re-types `Sale price` + `Category` from the linked
`production items` row; `production items` also carries 8 `<Stage> % override`
number fields.
- **Verified:** the 8 `% override` fields on `production items` appear **vestigial** —
  the effective stage % lives on the pay tracker (`Stage % → Rule → Rule Stage % →
  Effective Stage %`); no formula references the production-items overrides.
- **Manual (UI):** convert pay tracker `Sale price` + `Category` to **rollups** off
  the existing `Production item` relation (then rewrite the `Owed` formula, which
  references `Sale price`, to use the rollup); after confirming nothing references
  them, delete the 8 `<Stage> % override` fields on `production items`.

### #11 — Sizes Offered vs Sizes Available  (🔴 shop-backed) — KEEP BOTH, clarify
The shop reads **both**, distinctly (see "What the app depends on" above): Offered =
picker set; Available = in-stock flag. **Do not collapse, and do not rename** (the
code matches the exact strings). Property *descriptions* can't be set through the
schema API, so:
- **Manual (UI):** add a description to each property — Offered: "Every size band this
  item is made in — defines the size picker on the shop." Available: "Which of those
  bands are currently in stock — unchecked bands show sold-out + a notify button."

## Net result of this pass
- **Applied:** #7 fully (code + both CRM relations); #5 + #8 additive scaffolding
  (relations + rollups). All additive/non-destructive.
- **Left for the atelier (UI/manual):** the formula rewrites (#5, #10), data
  migrations + type conversions + field deletions (#8, #10), the orphan-price delete
  (#6), the costing unify (#4), the size-field descriptions (#11), and — for #9 —
  nothing but this note.
