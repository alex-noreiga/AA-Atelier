---
name: Notion database review (orders / production / finances)
description: A read-only reevaluation of the A.A. Atelier Notion workspace for duplicate logic, logic gaps, and simplification opportunities, with per-finding status and app-safety flags. Captures the state after the P1 and P2 cleanups were applied.
---

# A.A. Atelier — Notion Database Review

## Context

The atelier runs on a Notion workspace of ~20 databases across three hub pages —
**orders**, **production**, **finances** — plus the main `{ A.A. Atelier }` page.
It has grown organically, and several databases overlapped or had drifted out of
sync. This review reevaluated the whole workspace for **duplicate logic, logic
gaps, and simplification opportunities**.

Every finding was derived from the live schema (property types, relation targets,
rollup/formula definitions, row counts) read read-only via the Notion API — not
from property names alone. Findings are flagged for app-safety:

- 🟢 **internal-only** — the deployed website does not read this database, so
  changes are safe to make in Notion alone.
- 🔴 **app-backed** — the website reads this database live; schema changes
  (renames, deletes, type changes) need a matching code change or they break the
  site. Additive relations/rollups are generally safe.

Websites reads live (🔴): Order Tracking Pipeline, invoices & payments, Invoice
Line Items, inventory, Product Categories, Shop Orders, Website Contact Messages,
Production Schedule.

**Status legend:** ✅ resolved · ◑ mostly done, small tail · ○ open / unchanged.

This document was written after the **P1** and **P2** cleanups had been applied
and re-verified against live Notion. **P3 remains open.**

## Database inventory

| Hub | Databases |
|---|---|
| orders | Order Tracking Pipeline, Client CRM, Production Schedule, Invoice Line Items, Shop Orders (+ Website Contact Messages on the main page) |
| production | inventory, material usage, materials inventory, material intake, Product Categories, Supplier directory |
| finances | finances overview, costing (Channel: Custom/Production/Rhinestone), costing (production items) *(legacy)*, invoices & payments, production pay tracker ("Stage work entries"), production items, Pricing Settings, stage percentage split rules (+ Rhinestone Cost Calculator *(legacy)* on the main page) |

## P1 — Broken / incorrect — ✅ RESOLVED

1. ✅ **Client CRM `Total Deposits` rollup removed.** It had pointed at a deposit
   field deleted in the 2026-07 invoice migration and rendered blank. Gone; the
   CRM's remaining rollups (`Order Count`, `Order Stages`) resolve correctly.
   (Residual: no client-level deposit/lifetime-value figure — see #16.) 🟢
2. ✅ **Product Categories description corrected.** The `Name` note now describes
   the `Category` relation and states the old inventory "Item Type" select was
   retired; no longer references a nonexistent field. 🔴 (note-only change)
3. ✅ **Production Schedule `Production Stage` select** now carries a real option
   ("Delivered") instead of being empty; the milestone cron auto-creates the rest
   as it writes rows. 🔴

## P2 — Duplicate logic — mostly RESOLVED

4. ◑ **Costing engines unified.** The `costing` table gained a `Channel`
   (Custom / Production / Rhinestone) and absorbed all three engines' fields +
   formulas; it is wired into Order Tracking, Invoice Line Items, and inventory.
   **Cleanup tail:** the legacy `costing (production items)` table and the
   standalone `Rhinestone Cost Calculator` still exist, and `inventory`'s
   `Suggested Price` / `Material Usage Lines` rollups still read the *legacy*
   production-costing table (inventory carries two costing relations: `Priced
   Item` → legacy, `Costing Item` → merged). **To finish:** repoint inventory's
   rollups to the merged table, then retire the two legacy tables. 🟢 (keep the
   Invoice Line Items link intact)
5. ✅ **`Pricing Settings` wired.** Both costing tables now carry a `Pricing
   Settings` relation + `Default … (from settings)` rollups (hourly rate, selling
   fees, profit margin); defaults flow instead of being hand-copied. 🟢
6. ◑ **Price fields reconciled.** `inventory.Suggested Price` now rolls up from
   costing; `Listed Price` is the manual chosen price (a sensible suggested-vs-
   listed pair). `production items.Sale price` stays separate for pay math. Fully
   clean once #4's legacy table is retired and the rollup repointed. 🔴
   (`inventory.Listed Price` is read by the shop)
7. ✅ **Customer identity linked.** Shop Orders and Website Contact Messages both
   gained a `Client` relation → Client CRM (Order Tracking already had one).
   Free-text name/email remain as raw capture (app-backed writes), but every
   touchpoint now ties to one client record. 🔴 (additive, safe)
8. ◑ **Supplier deduplicated.** `materials inventory` now has a `Supplier
   Directory` relation and its free-text `Supplier` is gone. **Residual:**
   `material intake` still keeps a redundant `Supplier` text beside its relation,
   and `Supplier directory.Materials tracked` can now become a rollup (the
   relation exists). 🟢
9. ○ **Invoice relation double-paths — unchanged.** Order links directly to both
   `Invoices` and `Invoice Line Items`; line items link to both `Invoice` and
   `Order`. Lowest priority and likely intentional — recommend documenting
   Order → Invoice → Line Items as canonical rather than removing either. 🔴
10. ◑ **`production pay tracker`** — `Category` is now a rollup; `Sale price` is
    still typed manually (could roll up from the linked `production items`). The
    per-stage `% override` fields on `production items` still overlap the `stage
    percentage split rules` mechanism. 🟢
11. ✅ **`Sizes Offered` vs `Sizes Available`** — kept but now documented as two
    distinct axes (made-in bands that drive the shop's size picker vs. currently
    in-stock bands). No longer ambiguous duplication. 🔴

## P3 — Logic gaps / simplification — OPEN

12. ○ **`finances overview` is empty and 100% manual** — no link to invoices
    (income) or material intake/usage (expenses), so there is no real P&L.
    Recommend driving income/expense from rollups, or replacing it with
    rollup-fed views over the existing finance tables. 🟢
13. ✅ **Funnel connected (with #7).** Website Contact Messages and Shop Orders
    both gained a `Client` relation → Client CRM. Remaining nicety: populate those
    relations as records arrive, and add a `Status`-driven Leads-vs-Active view. 🔴
14. ○ **Manual fields that could be rollups:** `Order Tracking.Email` (owned by
    the linked Client), `inventory.Quantity Sold`, `Supplier directory.Materials
    tracked` (relation now exists), and most of `Production Schedule` (mirrors its
    linked order). 🔴/🟢 mixed — Email is app-backed, the rest internal.
15. ○ **`max` aggregation on material cost rollups.** `material usage.Material
    Unit Cost` and `material intake.Material Unit Cost` both aggregate the linked
    material's price with `max`. Fine for single-material lines, but semantically
    the wrong function — worth switching to something unambiguous. 🟢
16. ○ **(Optional) Client lifetime value.** With the broken `Total Deposits`
    rollup removed (#1), the CRM has no view of what a client has paid. If wanted,
    add a CRM → invoices & payments relation and roll up `Final Balance` /
    deposits paid. 🟢

## Remaining work at a glance

- **#4** repoint `inventory` rollups to the merged `costing` table, then retire
  `costing (production items)` + the standalone `Rhinestone Cost Calculator`.
- **#8** drop `material intake`'s free-text `Supplier`; convert `Supplier
  directory.Materials tracked` to a rollup.
- **#10** roll `production pay tracker.Sale price` up from `production items`.
- **#12** wire `finances overview` (or replace with rollup views).
- **#14 / #15 / #16** convert the remaining manual fields to rollups; fix the
  `max` aggregations; optionally add CRM lifetime value.
- **#9** documentation-only: mark the canonical invoice relation path.

## Verification

- Every finding was checked against the live Notion schema via the API during
  this review; the P1/P2 items were re-verified after the owner applied fixes.
- The 🔴/🟢 flags were cross-checked against the website's Notion adapter and
  `CLAUDE.md`, which enumerate exactly which databases and property names the
  deployed code reads.
- Any single finding can be spot-checked by opening that database in Notion.
