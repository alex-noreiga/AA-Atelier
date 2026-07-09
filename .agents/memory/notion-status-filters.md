---
name: Notion status-property filter gotcha and live-syncing status options
description: Notion database property types must be verified before writing filter queries, and status/select options should be read live rather than hardcoded when the user manages them via the Notion UI.
---

When querying a Notion database via the API, the `filter.property` type in the request must exactly match the live property type in the database, or the API returns a 400 `validation_error` ("database property text does not match filter number").

**Why:** A field named like a number (e.g. "Order Number") is not guaranteed to actually be a Notion `number` property — the user may have created it as `rich_text` instead. This happened on the order-status-lookup project: the field was assumed to be `number` from its name, but was actually `rich_text`, and stored values had leading zeros (`"00000"`, `"000002"`) which wouldn't round-trip through numeric parsing anyway.

**How to apply:** Before writing a Notion filter against a property, query a sample page from the database first and inspect the actual `type` key on that property in the response (not just the property name) to build the correct filter shape (`rich_text: { equals }`, `number: { equals }`, `status: { equals }`, etc.). Treat order/reference numbers with possible leading zeros as strings, not numbers.

## Don't hardcode Notion status/select options in app code

If an app surfaces a Notion `status` or `select` property's option list (e.g. a pipeline/stage tracker), do not hardcode the option list in the codebase — the business user manages those options directly in the Notion UI and expects changes (added/renamed/reordered/removed options) to show up without a code change or redeploy.

**Why:** On the order-status-lookup project, the stage list was hardcoded twice and broke both times the atelier team edited it in Notion — once needing a full rescope, and once for a same-session typo fix that would otherwise have required another code deploy.

**How to apply:** Fetch the property's live option list from `GET /v1/databases/{database_id}` (read `properties.<PropertyName>.status.options` or `.select.options`, in the order Notion returns them) on each relevant request or with a short in-memory TTL cache (e.g. 60s), rather than baking the list into a constant. Also handle the edge case where a record's current option value doesn't appear in the freshly-fetched list (e.g. renamed the instant before rendering) by falling back gracefully instead of crashing or silently showing nothing active.
