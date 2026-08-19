# Google sign-in (Supabase Auth) — setup runbook

`pages/account-login.tsx` has always shipped a **"Continue with Google"** button
(`supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo:
callbackUrl() } })`). **No code change is needed to turn it on** — the button,
the PKCE flow, the `/account/callback` landing page, and the Bearer-token seam
are all already wired (see `account-portal.md`). What was missing is
configuration, in two dashboards: **Google Cloud Console** (create the OAuth
client) and **Supabase → Authentication** (enable the provider + allow the
redirect). Neither is API-reachable from this repo's tooling, so this file is
the version-controlled runbook — the same pattern as `supabase-auth-emails.md`.

## Project facts (fill these in verbatim)

| Thing                                   | Value                                                                                                               |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Supabase project                        | `supabase-atelier`, ref `nrxfyhootpklhugegzsq`                                                                      |
| Supabase URL                            | `https://nrxfyhootpklhugegzsq.supabase.co`                                                                          |
| **Google "Authorized redirect URI"**    | `https://nrxfyhootpklhugegzsq.supabase.co/auth/v1/callback`                                                         |
| Google "Authorized JavaScript origin"   | `https://a3iceanddance.com` (+ `http://localhost:5173` for dev)                                                     |
| Supabase **Site URL**                   | `https://a3iceanddance.com` (the apex — see below)                                                                  |
| Supabase **Redirect URLs** (allow-list) | `https://a3iceanddance.com/account/callback`, `https://a3iceanddance.com/account/reset`, `http://localhost:5173/**` |

## Step 1 — Google Cloud Console

1. Pick (or create) a project at <https://console.cloud.google.com>. It can be
   the **same** project that holds the Calendar/Sheets service account used for
   appointment booking — an OAuth client and a service account are independent
   credentials and do not conflict.
2. **APIs & Services → OAuth consent screen**: User type **External**. Fill in the
   app name, support email, and developer contact. Scopes: the defaults
   `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile` are all the
   portal needs — identity here is only the email address (see
   `account-portal.md`), so **add no other scopes**.
3. **Publish the consent screen.** While it is in "Testing", only the explicitly
   listed test users can sign in; every other customer gets Google's
   "Access blocked: … has not completed the Google verification process". A
   screen requesting only the three non-sensitive scopes above publishes without
   a Google review.
4. **Credentials → Create credentials → OAuth client ID**, type **Web
   application**:
   - _Authorized JavaScript origins_ → the origins in the table above.
   - _Authorized redirect URIs_ → **the Supabase callback**
     `https://nrxfyhootpklhugegzsq.supabase.co/auth/v1/callback`.
5. Copy the **Client ID** and **Client secret**.

> **The single most common mistake** is putting the app's own
> `https://a3iceanddance.com/account/callback` into Google's _Authorized redirect
> URIs_. Google redirects to **Supabase**, and Supabase then redirects to the
> app. The app callback belongs in Supabase's allow-list (step 2), never in
> Google's.

## Step 2 — Supabase dashboard

1. **Authentication → Sign In / Providers → Google**: toggle **Enable**, paste
   the Client ID + Client secret, Save. (Leave "Skip nonce check" off — it is for
   Google One Tap / native apps, not this web flow.)
2. **Authentication → URL Configuration**:
   - **Site URL** = `https://a3iceanddance.com`.
   - **Redirect URLs** = the allow-list in the table above.

**The Site URL must be the apex, not `www`.** The canonical host is the apex and
`www` 308-redirects to it (see `domain-redirect-loop.md`); pointing Supabase at a
host that immediately redirects is an avoidable way to lose the auth code.

**Vercel preview deployments** get a fresh random hostname each build, so Google
sign-in will fail there until a wildcard such as
`https://aa-atelier-*.vercel.app/**` is added to the Redirect URLs. Production is
unaffected. Adding it is optional — previews can be tested with email+password.

The Client **secret** lives only in the Supabase dashboard. It is not an app env
var, must not be committed, and needs no Vercel entry.

## Step 3 — verify

There is no new env var and nothing to redeploy — the provider list is read by
Supabase at sign-in time, so the change is live immediately. Sign in at
`/account/login` → "Continue with Google", which should land on
`/account/callback` and forward to `/account`.

Confirm server-side that a Google identity was actually created:

```sql
select provider, count(*) from auth.identities group by provider;
```

Before this setup that returned only `email`. A successful Google sign-in adds a
`google` row.

**Account linking:** a customer who already has an email+password account and
then signs in with the same Google address — Supabase links the identities when
the email matches and is verified on both sides, rather than creating a second
user. Worth confirming with the query above on a real account before relying on
it, because the portal is **email-keyed** end to end (`middlewares/auth.ts`
normalizes the token's email and every Notion lookup filters on it), so a
duplicate user would mean a customer seeing an empty dashboard.

## Troubleshooting (from the live setup, 19 Aug 2026)

**Read the Supabase auth logs first.** Dashboard → Logs → Auth, or via MCP:

```sql
select timestamp, log_attributes['path'] as path, log_attributes['msg'] as msg,
       log_attributes['error'] as error
from logs where source = 'auth_logs' order by timestamp desc limit 30
```

The `/callback` line carries the real reason, and the sign-in page now shows it too.
It did not during this setup: `pages/account-callback.tsx` reported **every** failed
return as _"That sign-in link has expired or already been used"_, because it only
tested whether a session existed and discarded the error Supabase sends back in the
URL — copy written for magic links, and nearly always wrong about the cause for
OAuth. That is fixed (`lib/auth-errors.ts` parses the redirect's `error` /
`error_code` / `error_description`, the callback forwards the code to
`/account/login?error=<code>`, and the sign-in page maps it to customer-facing copy
plus a quotable reference). The logs remain the place to read
`error_description`, which is deliberately not shown to customers.

Two failures actually hit during setup, in order:

1. `provider is not enabled` on `/authorize` — the Google provider hadn't been
   toggled on yet. Fixed by step 6.
2. `oauth2: "invalid_client" "The provided client secret is invalid."` on
   `/callback`, i.e. a 500 on **`Unable to exchange external code`**. Google had
   already accepted the sign-in and issued a code; only the token exchange failed.

For (2), note what the error does **not** mean. Google says "client secret" but the
condition is that the **client_id + client_secret pair** does not authenticate, so a
wrong ID, a pair drawn from two different clients, or the wrong Google Cloud project
all produce it identically. Re-pasting the secret alone did not fix it.

**The diagnostic that settles it:** start a sign-in and read `client_id` out of the
URL on Google's own screen. If Google renders a sign-in/consent page at all, the
client ID is valid, the client is a Web application, and its authorized redirect URI
is correct — Google resolves all of that before showing anything (an unknown client
returns `401: invalid_client / deleted_client` instead). That narrows the fault to
the secret with certainty.

**The fix that avoids the whole class:** on that exact client in Google Cloud
Console, use the **download icon (⬇) on the Credentials/Clients _list_ row** — not
the edit screen — to get a JSON carrying a matched `client_id` + `client_secret`,
and paste both. Copying the two values separately is what lets them drift apart. On
the current console the edit screen shows a **Secret ID** next to each secret, which
is not the secret; a secret's value is visible only in the panel shown at creation
(**+ Add secret**).

Config saves take effect on the next `reloading api with new configuration` line in
the logs (seconds), with no redeploy.

## Verified working

Live since 2026-08-19 15:00 UTC — `/callback` 302 clean, `/token` 200,
`Login provider=google`, and a `google` row in `auth.identities`. Sign-ins from
Vercel **preview** hostnames completed too, so the wildcard concern in step 10 did
not bite in practice.

Note the identity model this exposed: Google created a **separate user** for
`alexandra@a3iceanddance.com` alongside the existing password user
`alexandra.noreiga@gmail.com`. That is correct — Supabase links identities only when
the email matches — but because the portal is email-keyed, each account sees only the
Notion orders carrying its own address.

## What is deliberately not here

- **No code change.** Do not add a provider list, an env var, or a "Google
  configured?" flag — the button is unconditional and Supabase reports an
  unenabled provider as an error the existing handler already surfaces.
- **No `GOOGLE_SERVICE_ACCOUNT_KEY` involvement.** That credential is the
  Calendar/Sheets service account for appointment booking
  (`appointment-scheduling.md`) and is unrelated to customer sign-in.
