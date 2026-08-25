---
name: In-place measurement editing (the customer edits, the app writes)
description: PUT /orders/:n/measurements writes the five typed measurement properties directly instead of filing a change request — why every gate fails closed, why an unwritable edit is FILED rather than refused, and why the page body is appended to rather than rewritten.
---

Roadmap card 03. Until this, a customer who needed a measurement changed filed a
**request** (`POST /orders/:n/measurement-change-requests`) that a person read and
applied by hand in Notion. The values were already typed properties — the account
portal had been reading them back since the "measurements as typed fields" card —
so the only thing standing between the customer and the correct number was the
atelier's inbox.

`PUT /api/orders/{orderNumber}/measurements` closes it. The change-request flow
**stays**, for the two things an edit can't be: asking to be re-measured at a
fitting, and an edit the app can't safely write.

## The shape

|                                   | Change request                       | In-place edit               |
| --------------------------------- | ------------------------------------ | --------------------------- |
| Endpoint                          | `POST …/measurement-change-requests` | `PUT …/measurements`        |
| Writes                            | a row in the contact inbox           | the order's own properties  |
| Reviewed by a human first         | yes                                  | **no**                      |
| Partial values                    | allowed (a person reconciles)        | refused — all five required |
| "Measure me at a fitting"         | yes                                  | no (it asks for a service)  |
| Legacy order with no stored email | accepted, flagged unverified         | **filed, never written**    |

Code: `services/measurement-update.service.ts` (the gates),
`updateOrderMeasurements` in `lib/notion/orders.repository.ts` (the two-step
write), `buildMeasurementProperties` / `buildMeasurementRevisionBlocks` in
`orders.blocks.ts` (the pure builders), the two `measurementsUpdated*Email`
builders, and on the frontend `components/measurements-dialog.tsx` (tracking
page) + `components/account-measurements.tsx` (portal), sharing
`components/measurement-fields.tsx` + `lib/measurements.ts`.

## The load-bearing decisions

1. **Removing the human reviewer is the whole risk, so the gates fail closed.**
   The email on an order is not a secret, and after this an order number plus a
   guessed address changes what a garment is cut to. So: a **contradicting**
   email is refused outright (403), the production lock is enforced exactly as
   the change request enforces it (409), and the customer is **always** emailed a
   receipt showing each value's before and after. That receipt is not a
   courtesy — it is the tripwire, read by the one person certain to notice an
   edit they didn't make, which is why it lists what changed rather than merely
   confirming that something did.

2. **An edit that can't be trusted or can't be stored is FILED, not refused.**
   Two cases: an order carrying no email at all (nothing to verify against), and
   an orders database without the measurement properties. Both would be a
   dead end for the customer, so `fileAsChangeRequest` hands the same values to
   `submitMeasurementChangeRequest` and the response says `outcome: "filed"`.
   Nothing the customer typed is lost, nothing unvetted is written, and the UI
   says which happened — claiming a save for an edit that only reached an inbox
   would have someone believe numbers are in force that aren't.

   It **re-reads the order** to do this (one extra Notion request on a rare
   path). That buys the guarantee worth more: a filed request is one the request
   endpoint itself produced, rather than a near-copy that drifts the first time
   either changes.

3. **The lock is checked BEFORE the unverifiable-order fallback.** A legacy
   order that is also in production must get the lock answer — filing a request
   there would file one the change-request flow would itself refuse. Pinned by a
   test.

4. **`resolveEmailVerification` is deliberately NOT reused.** Its entire contract
   is to return `false` — accept, unverified — for the no-email case, and
   "accept" is the one thing a direct write must not do with it. The service
   splits the two halves itself: contradiction refused, absence delegated.

5. **The production lock still fails OPEN, and that is unchanged.**
   `measurementsLocked` reports unlocked when either stage is missing from the
   live list, because the atelier renames stages and freezing every order in the
   studio over a rename is the worse failure. The identity gate, not the lock, is
   what stands between a stranger and the write.

6. **The page body is APPENDED to, never rewritten.** The measurements live in
   two places on the order page: the typed properties (what the app reads) and
   the intake section in the page body (what the atelier reads at a glance). An
   edit rewrites the properties and appends a dated "Measurements updated"
   section listing each new value with what it was. Overwriting the intake
   section would destroy the only record of what a part-made garment was
   actually cut to. So the page reads chronologically, and a value that didn't
   move carries no "(was …)" — a revision listing five values as changes buries
   the one that did.

7. **The two writes are not atomic, and the order is deliberate.** Notion has no
   transaction across a property PATCH and a block append. Properties go first
   (they are what the app reads back and what the customer is told was saved);
   a failed append is a `warn` and the edit still reports success, because
   re-running it to recover a paragraph would rewrite the properties again and
   file a duplicate revision.

8. **A missing property throws here, where intake drops it.**
   `createPageDroppingUnknownProperties` drops an un-added property at intake and
   keeps the order, because the value survives in the page body. Here the value
   IS the write, so `MeasurementPropertiesMissingError` is thrown, the `warn`
   names the property to add, and the edit is filed (point 2). Same state,
   opposite correct answer.

9. **All five values are required, unlike the change request.** A person reading
   a request can reconcile a partial one against what's on file; a write can't.
   A partial write would leave the atelier cutting to a mix of old and new
   numbers. The unit rides with them for the same reason — rewriting a waist
   without its unit is how 26 inches silently becomes 26 centimetres.

10. **`AccountOrderSummary.measurementsLocked` is derived server-side.** The lock
    stage is a Studio Setting the browser never sees, so a dashboard deriving the
    lock client-side would offer an edit the server then refuses. It mirrors the
    same field on `OrderStatus`.

11. **The portal seeds the form from the stored values; the tracking page does
    not.** The portal is signed in and already holds them. `GET /orders/:n` is
    keyed on an order number alone and deliberately returns **no** measurements —
    prefilling there would publish them to anyone who knows the number. So the
    anonymous surface asks for all five fresh, and the signed-in one lets a
    customer correct one value without retyping four.

12. **`parseMeasurement` exists because `Number("") === 0`.** A blank field would
    otherwise validate as a real zero and be saved as a measurement. Blank,
    non-numeric and non-positive all collapse to `null`, and both forms refuse
    it; the contract's `exclusiveMinimum: 0` is the second line.

## Atelier setup

**None beyond what the account portal already needed** — the five `number`
properties (`Waist`, `Chest`, `Hips`, `Height`, `Body Girth`) plus the
`Measurement Unit` `select` on the Order Tracking Pipeline. No env var, no new
database, no Notion automation. Until those properties exist, every edit is
filed as a change request and the logs name the missing property.

## Known limits

- **No edit history in the app.** The revision trail is page-body prose the
  atelier reads; nothing queries it. A customer sees only the current set.
- **Last write wins.** Two edits in flight for one order — the customer on their
  phone and the atelier in Notion — resolve to whichever lands second, with no
  conflict detection. The revision trail is what makes that recoverable.
- **The lock is the only time gate.** A customer can edit as often as they like
  before cutting; each edit emails the atelier, which is the throttle.
