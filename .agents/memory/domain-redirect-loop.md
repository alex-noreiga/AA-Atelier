---
name: Custom-domain redirect loop (www vs. apex)
description: Why www.a3iceanddance.com broke — a redirect loop from vercel.json and the Vercel domain config pointing at each other — and the canonical-host decision that resolves it.
---

## Symptom

`www.a3iceanddance.com` (and, in practice, the apex too) returned a browser
`ERR_TOO_MANY_REDIRECTS` — the custom domain was unreachable while the app
itself was healthy (the `*.vercel.app` deployment served `200 OK`).

## Root cause: two redirects pointing at each other

The canonical host for this site is the **apex** `a3iceanddance.com`. Every SEO
signal in the built HTML says so — `<link rel="canonical" href="https://a3iceanddance.com/">`,
`og:url`, and the `Organization`/`WebSite` JSON-LD all use the apex. The SEO
commit (`5d1d520`) added a `vercel.json` redirect to enforce it:

```jsonc
// vercel.json — CORRECT, keep it
"redirects": [
  { "source": "/:path*",
    "has": [{ "type": "host", "value": "www.a3iceanddance.com" }],
    "destination": "https://a3iceanddance.com/:path*",
    "permanent": true }
]
```

But the **Vercel project's domain settings** still had the opposite,
setup-era redirect: `a3iceanddance.com` → `www.a3iceanddance.com` (www was
left as the primary domain). The two layers fire in sequence at the edge:

```
browser → www  --(vercel.json)-->  apex  --(Vercel domain config)-->  www  --> ... loop
browser → apex --(Vercel domain config)--> www --(vercel.json)--> apex --> ... loop
```

Domain-level redirects (dashboard "Redirect to…") are applied at the edge
**before** the deployment's `vercel.json`, so no code change to `vercel.json`
can override a domain redirect pointing back at it. The conflict is only
resolvable in the Vercel domain configuration.

Confirmed live via the Vercel API: apex returned `308 → https://www.a3iceanddance.com/…`
while `vercel.json` (in the deployed `main` commit) redirects www → apex.

## Fix (Vercel dashboard — not a repo change)

Project **aa-atelier** → Settings → Domains:

1. Set `a3iceanddance.com` to **No Redirect** (serve directly) — i.e. make the
   apex the primary/production domain.
2. Set `www.a3iceanddance.com` to **Redirect to `a3iceanddance.com`** (308).
   This matches — and is now redundant with — the `vercel.json` rule; keeping
   both is harmless because they point the same way.

The one load-bearing change is that **the apex must stop redirecting to www.**
That alone breaks the loop: www → apex, apex serves.

Do **not** "fix" this by deleting the `vercel.json` www→apex redirect. That
would also stop the loop, but by making **www** the served host — which
contradicts every canonical/`og:url`/JSON-LD tag in the app (all apex). If the
canonical host is ever intentionally switched to www, flip those tags too.

## Also worth checking if the domain still looks "broken"

- **Deployment Protection / Vercel Authentication:** if enabled on the
  _production_ environment, every public visitor is gated behind a Vercel login
  (401) regardless of the redirect config. Confirm production is **not** behind
  Standard Protection (Settings → Deployment Protection).
- Stray extra domains `aa-atelier.com` / `www.aa-atelier.com` are also attached
  to the project; make sure whichever ones are meant to be live have their own
  sane redirect target (typically → `a3iceanddance.com`) and aren't part of a
  second loop.
