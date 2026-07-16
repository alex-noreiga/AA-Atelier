<!--
Keep it short. The CI (typecheck, format:check, build:vercel, tests, e2e) is the
gate — this template is for the human context CI can't infer.
-->

## Summary

<!-- What does this change and why? One or two sentences. -->

## Changes

<!-- Bullet the notable changes. Call out anything load-bearing (Notion/Stripe/
Google adapters, the OpenAPI contract, env vars). -->

-

## Contract & env

<!-- Tick if relevant, else delete this section. -->

- [ ] Touches `lib/api-spec/openapi.yaml` — ran `pnpm --filter @workspace/api-spec run codegen`
- [ ] Adds/changes an env var — documented in `.env.example` and CLAUDE.md's Vercel env list

## Testing

<!-- How you verified this. Delete lines that don't apply. -->

- [ ] `pnpm typecheck`
- [ ] `pnpm test` (unit + integration)
- [ ] `pnpm test:e2e`
- [ ] `pnpm format:check`
- [ ] `pnpm build:vercel`
