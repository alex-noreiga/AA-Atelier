# Setup guide — appointment scheduling (Google Calendar + working hours)

This walks through everything needed to turn on **appointment booking**. Conflicts
come from Google: each staff member's Google Calendar free/busy is subtracted
from their working hours, and bookings are written as calendar events (with a
Google Meet link for virtual). The bookable **working hours** themselves live in the
site's own database and are edited from the **studio dashboard**, no redeploy needed.

You do this once. Plan ~20 minutes. You'll need:

- A **Google Cloud** account (to create the service account + key).
- **Google Workspace admin** access (for the one domain-wide-delegation step).
- **Vercel** project access (to set the environment variables).

> The rest of the app (orders, shop, contact) has its own env vars — see
> [`.env.example`](.env.example). This guide covers the appointment feature.

---

## Part A — Create the Google service account + key

1. Go to **[console.cloud.google.com](https://console.cloud.google.com)** and
   select (or create) a project.
2. **Enable the API** — search it in the top bar and click **Enable**:
   - **Google Calendar API**
3. **Create a service account:** _APIs & Services → Credentials → Create
   credentials → Service account_. Name it (e.g. `atelier-scheduler`) and click
   **Done**. It needs no roles.
4. Open the service account and note two things:
   - its **email** — looks like
     `atelier-scheduler@your-project.iam.gserviceaccount.com` (the `client_email`
     in the key file);
   - its **Unique ID** (a long number) — the "Client ID" for Part B.
5. **Create a JSON key:** on the service account, open the **Keys** tab →
   _Add key → Create new key → JSON_. A `.json` file downloads. **Its entire
   contents are the value of `GOOGLE_SERVICE_ACCOUNT_KEY`.** Keep it secret; don't
   commit it.

> **If steps 1 or 5 are blocked** by your organization (a "select a parent
> resource" error on project creation, or a greyed-out "Create key" button),
> that's an org security policy. Either have a Google Cloud admin grant the
> exception (Project Creator role / an override of
> `iam.disableServiceAccountKeyCreation` for this project), or create the project
> under a personal Google account — the credential still works for your Workspace
> because delegation (Part B) is authorized separately by the Client ID.

---

## Part B — Authorize calendar access (domain-wide delegation)

This lets the service account act _as_ each staff member — read their free/busy,
create events on their calendar, invite the customer, and make Meet links. Do
this at **[admin.google.com](https://admin.google.com)** as a Workspace admin.

1. **Security → Access and data control → API controls**.
2. **Manage Domain-Wide Delegation → Add new**.
3. **Client ID:** paste the service account's **Unique ID** (from Part A, step 4).
4. **OAuth scopes:** paste exactly:
   ```
   https://www.googleapis.com/auth/calendar
   ```
5. **Authorize.**

> This delegation is **only** for Calendar. The working hours (Part C) live in
> the site's own database and don't involve Google at all.

---

## Part C — Set up the working hours

This is the "when are we open" schedule. You edit it on the studio dashboard any
time; the site picks up changes within about a minute, with no redeploy.

**There is nothing to create.** The hours live in the site's own database
(Supabase Postgres), in a table the app creates for you. They used to live in a
Google Sheet, and then in a Notion database — both are retired, because once the
dashboard grew a proper editor there was no reason for the schedule to sit in a
third-party tool nobody edited it in.

### 1. Make sure the table exists

The table ships as a migration. Someone with repo access runs it **once**, from
the repo:

```
pnpm --filter @workspace/api-server db:migrate
```

(On GitHub this is the manual **Migrate** workflow → **Run workflow**.) It needs
`POSTGRES_URL_NON_POOLING` set — on Vercel the Supabase integration provides it.
If the site's other Supabase-backed features already work, this is likely done
already; running it again is safe, as it skips migrations already applied.

### 2. Nothing to share, and no id to copy

Unlike every other database the studio uses, this one needs no Notion
connection, no service-account share, and **no environment variable of its own**
— it uses the `POSTGRES_URL` the site already has. Skip straight to step 3.

### 3. Enter the hours on the dashboard

Once the env var is set (Part D) and the site has redeployed, sign in and open
**/studio → Working hours**, then **Add hours** for each block someone works:

| Who       | Booking calendar            | Days    | From  | To    | Bookable for       |
| --------- | --------------------------- | ------- | ----- | ----- | ------------------ |
| Alexandra | alexandra@a3iceanddance.com | Mon–Fri | 10:00 | 17:00 | In person, Virtual |
| Alayna    | alayna@a3iceanddance.com    | Sat     | 11:00 | 16:00 | Virtual            |

Add as many blocks as you need — split shifts, different hours per day, a
Saturday that's virtual-only. Two things the editor won't let you save, because
they'd produce hours nothing could be booked into: a person the studio doesn't
book, and an end time before the start time.

**A day off is not an edit here.** Block it on the staff member's Google Calendar
and it's subtracted automatically — this database is the standing week.

---

## Part D — Set the environment variables in Vercel

1. Go to **[vercel.com](https://vercel.com)** → your project.
2. **Settings** (top tab) → **Environment Variables** (left sidebar).
3. Add each variable below with **Add Another** / **Save**. For each, tick the
   environments you want it in — at least **Production** (add **Preview** too if
   you want booking to work on preview deploys):

   **Required**

   | Key                          | Value                                                                                                                                 |
   | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
   | `GOOGLE_SERVICE_ACCOUNT_KEY` | The **entire contents** of the JSON key file from Part A. Paste it verbatim — the escaped `\n` newlines inside are handled correctly. |

   **Optional (sensible defaults if unset)**

   | Key                                | Default                             | Notes                                                                                                 |
   | ---------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------- |
   | `APPOINTMENT_TIMEZONE`             | `America/Chicago`                   | Set your actual IANA zone (e.g. `America/Toronto`). Working hours + slot times are read in this zone. |
   | `APPOINTMENT_MIN_LEAD_HOURS`       | `24`                                | How far ahead a slot must be to be bookable.                                                          |
   | `APPOINTMENT_MAX_ADVANCE_DAYS`     | `45`                                | How far into the future booking is allowed.                                                           |
   | `APPOINTMENT_SLOT_STEP_MINUTES`    | `15`                                | The grid slots snap to within working hours.                                                          |
   | `RESEND_APPOINTMENTS_FROM_EMAIL`   | falls back to `RESEND_FROM_EMAIL`   | Send booking mail from a separate address, e.g. `A.A Atelier <appointments@a3iceanddance.com>`.       |
   | `ATELIER_APPOINTMENTS_INBOX_EMAIL` | falls back to `ATELIER_INBOX_EMAIL` | Copy of each booking to a separate inbox.                                                             |

4. **Redeploy so the variables take effect.** Environment-variable changes only
   apply to _new_ deployments. Either:
   - **Deployments** tab → the latest deployment → the **⋯** menu → **Redeploy**; or
   - push any commit to the branch Vercel deploys.

> For **local development**, put `GOOGLE_SERVICE_ACCOUNT_KEY` and the
> `POSTGRES_URL` / `POSTGRES_URL_NON_POOLING` pair in your repo-root `.env` (see
> `.env.example`), then run the migrate command from Part C, step 1.

---

## Part E — Verify it works

1. After the redeploy, open the site's **Book an Appointment** page and pick a
   purpose and format — open times should appear.
2. **Prove the calendar link is live:** add a busy event on a staff member's
   Google Calendar _inside_ their working hours, reload the booking page, and
   confirm that time disappears from the available slots.
3. **Prove booking works:** book a slot, then check that the event lands on the
   staff calendar, the customer receives a Google Calendar invite, and a virtual
   booking includes a Google Meet link.
4. **Prove the hours are live:** change a time under **/studio → Working hours**
   and confirm the offered slots shift within about a minute — no redeploy
   needed.

### If no slots show up

- The domain-wide-delegation scope must be **exactly**
  `https://www.googleapis.com/auth/calendar` (a typo or a narrower scope silently
  blocks it).
- There must be **working hours on record** — an empty schedule offers no times.
  Check **/studio → Working hours**; the dashboard says so plainly when it's
  empty.
- Confirm the **Calendar API** is enabled on the project.
- Confirm `POSTGRES_URL` is set and the migration from Part C, step 1 has been
  run — the working hours are stored there, so without it the booking page can
  offer nothing at all.
