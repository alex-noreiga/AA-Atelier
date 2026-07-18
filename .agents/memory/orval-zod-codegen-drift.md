---
name: orval codegen emits zod v4 syntax the pinned zod v3 can't run
description: Running the api-spec codegen regenerates generated zod with `zod.email()` (v4), which fails to typecheck against the repo's pinned zod 3.25 — restore `zod.string().email()` after any codegen run until the version mismatch is fixed at the root.
---

Running `pnpm --filter @workspace/api-spec run codegen` (orval **v8.22.0**) regenerates
`lib/api-zod/src/generated/api.ts` with **zod v4** email syntax — `zod.email()` — on every
`email` field. The repo pins **zod 3.25.76**, whose top-level export has **no** `z.email()`,
so the post-codegen `typecheck:libs` fails with:

```
lib/api-zod/src/generated/api.ts(NN,16): error TS2339: Property 'email' does not exist on type 'typeof zod'.
```

This is **independent of whatever spec change triggered the regen** — orval rewrites the email
lines regardless. The committed-good form is `zod.string().email()` (v3-compatible); someone
before must have hand-corrected it or run a different orval/zod combo.

**Why:** orval's zod generator now targets zod v4's flat API (`z.email()`, `z.iso.date()`, etc.),
but the workspace hasn't moved to zod v4. So codegen output and the installed runtime disagree.

**How to apply:** After any codegen run, if `email` fields came back as `zod.email()`, restore them:

```
perl -pi -e 's/zod\.email\(/zod.string().email(/g' lib/api-zod/src/generated/api.ts
```

Then re-run `pnpm typecheck`. The proper root fix (out of scope for a feature change) is one of:
bump zod to v4 across the `catalog:` in `pnpm-workspace.yaml`, pin orval to a version that emits
v3 syntax, or set an orval option to target zod v3 — pick when someone owns the zod upgrade.
Watch for the same drift on other v4-only helpers (dates, etc.) if more formats are added to the spec.
