---
name: Buying shipping labels in-app (Shippo)
description: The atelier rates and buys a label for a shop order from the studio dashboard, and the order's Carrier / Tracking Number / Tracking URL fill themselves — the last three columns on an order still copied by hand from a second website.
---

# Buy shipping labels in-app

Roadmap card ③: "wire a label vendor so the atelier buys a label from the order
and the `Carrier`, `Tracking Number` and `Tracking URL` fields fill themselves."

The striking thing about this card is how little of it is customer-facing.
Those three columns have been read by `lib/fulfilment.ts` since the
shipping-and-pickup card shipped, identically for custom and shop orders, and
the tracking panel renders them the moment they exist. So this adds a **writer
to a pipeline that was already finished** — no contract change on any
customer-facing endpoint, no frontend change outside `/studio`, and nothing at
all for a customer to notice except that their tracking number appears sooner
and is never mistyped.

## What shipped

| Piece                                                   | What it is                                                 |
| ------------------------------------------------------- | ---------------------------------------------------------- |
| `lib/shipping/address.ts`                               | A postal address in its parts + what makes one postable    |
| `lib/shipping/parcels.ts`                               | The studio's packaging, as a code catalog, + weight sanity |
| `lib/shipping/from-address.ts`                          | The studio's own origin, from seven Studio Settings keys   |
| `lib/shippo/client.ts`                                  | Lazy token read, `shippoConfigured()`, `shippoTestMode()`  |
| `lib/shippo/labels.repository.ts`                       | The two vendor calls: rate a parcel, buy a rate            |
| `services/shipping-label.service.ts`                    | The gates, the Stripe address read, the write-back         |
| `findShopOrderForShipping` / `recordShopOrderTracking`  | The Notion read and the Notion write                       |
| Three `/studio/shipments/*` routes                      | Contract-first, `requireStaff` like the rest of `/studio`  |
| `components/studio-shipping.tsx` + a `shipping` section | The dashboard panel                                        |

**Vendor: Shippo.** No monthly fee, per-label pennies on top of postage,
discounted USPS/UPS/FedEx rates, a real test mode, and a plain REST API — so it
is a raw-`fetch` adapter like Notion and Google rather than an SDK dependency.

## The decisions worth keeping

1. **The ship-to address comes from STRIPE, never from Notion.** A shop order
   has carried a `Shipping Address` since checkout shipped, but as one display
   line assembled by `formatShippingAddress` for a human — `"12 Rink Rd, Apt 4,
Austin TX 78701, US"`. Parsing that back into components is guesswork: the
   comma before the country is a different kind of comma from the one after
   "Apt 4", a two-word city breaks the state heuristic, and an address line with
   a comma in it breaks everything. A guessed address is a parcel that doesn't
   arrive. Stripe collected the address in its parts and still holds them, and
   the order stores its session id, so the structured address is one retrieve
   away. Same instinct as "Stripe is the source of truth for money".

   The corollary is the honest refusal: an order with **no Stripe session** (a
   hand-filed Etsy or skate-shop row) has no address in its parts, so it is
   refused with 409 telling the atelier to buy that label wherever they took the
   order — rather than parsing the display line as a fallback, which is the one
   thing this whole design exists to avoid.

2. **It is two operations, and that is the point.** A label has a carrier, a
   service level and a price; the gap between the top and bottom of a rate list
   is routinely three days and eleven dollars, and only the atelier knows
   whether the dress is needed on Saturday. So there is no "buy the cheapest"
   shortcut, and money moves only in the second call. This is also why the flow
   does **not** live under `/studio/tools/:tool` like the other seven actions:
   that shape is one press and one composed result, and nothing about it can
   carry a list back and take a choice.

3. **The ORDER is the idempotency guard, because the vendor isn't.** Shippo will
   sell a second label for the same parcel as happily as the first, and unlike a
   Stripe refund there is nothing to read back that says "you have already done
   this" (`refunds.list` has no analogue here). So an order that already carries
   a `Tracking Number` is refused with 409, and buying a replacement — for a
   label that was voided — is the explicit `replace` flag, confirmed in the
   panel. Same shape as the status email's `force`.

   The **rates** call deliberately does not apply that guard: asking what a
   second label would cost is reasonable, and the refusal belongs where money
   moves, not where a question is asked.

4. **The purchase outranks its bookkeeping — and this is the opposite call from
   the refund flow.** `recordShopOrderRefund` is best-effort and resolves
   `false`, because the money has already moved and **Stripe** is what the next
   run reads; a lost marker costs visibility only. `recordShopOrderTracking` is
   the reverse: this write is the **only** record of the tracking number the
   customer will ever see, so losing it means a label bought, a parcel posted,
   and a tracking page that says nothing forever. But throwing would lose the
   label too — so the failure is **reported**: 200, `recorded: false`, the
   tracking number and label URL in the body, and a panel that says to paste the
   number into Notion. Logged at `error`, not `warn`.

5. **Test mode is said out loud, every time.** A Shippo test label has a
   tracking number, a PDF and a price, and no carrier has ever heard of it — the
   one failure that looks exactly like success. It is read from the token's own
   prefix (`shippo_test_…`) rather than a second env var, so the two can't
   disagree, and it rides all the way to the panel as a banner and onto the
   result.

6. **A 201 is not a successful purchase.** Shippo answers HTTP 201 for a
   transaction whose `status` is `"ERROR"`, with the reason in `messages`.
   Reading only the status code would report a label bought, write a blank
   tracking number onto the order, and send the atelier to print nothing. So the
   transaction's own status decides — and a `SUCCESS` carrying no tracking
   number is a failure too, since a label nobody can track is not a label.

7. **The vendor's failures split the way Google's do.** A 4xx is the request's
   fault and its body names the field, so it surfaces as a `BadRequestError` the
   panel shows verbatim; a 5xx is the vendor's and clears itself, so it is a 503
   with a retriable message. Only one of the two is worth an alert.

8. **Dimensions are the catalog's; weight is not.** `PARCEL_PRESETS` is a code
   catalog like the appointment and service catalogs — served rather than
   duplicated, so a size the form offers is a size the server can rate. But what
   goes in a box is a dress one day and soakers the next, so the weight is typed
   per shipment. `weightProblem` refuses **zero** (a carrier rating a 0 oz
   package prices a document envelope) and anything over 800 oz / 50 lb, which
   is there to catch the one typo that matters: pounds typed where ounces were
   wanted.

9. **The ship-from address is seven Studio Settings keys, not one.** A single
   `SHIP_FROM_ADDRESS` split back apart here is exactly the parsing point 1
   exists to avoid, and it would fail at the worst moment: an origin postcode
   read wrong misprices every rate in the list, silently. Seven typed fields
   also let the settings editor validate each and the panel name the missing
   one. All but the country default to **empty** — there is no sensible built-in
   for somebody's address, and a placeholder would print on a real parcel.

10. **Both unconfigured states are reported, never thrown.** An unset token and
    a half-filled ship-from address are states only a human can clear, so
    `GET /studio/shipments/options` answers 200 with `problems[]` and the panel
    says which — the same shape as the materials panel's unreachable database
    and the settings editor's unconfigured one. The rate and label calls, where
    there is a request to refuse, answer 409.

11. **A pickup order and a cancelled order are refused.** Pickup is matched
    through the same `looksLikePickup` the tracking page reads the column with,
    so the rate the customer picked at checkout and the refusal here can't
    disagree about what counts as a collection.

## Atelier setup

1. **Open a Shippo account**, connect the carriers (USPS needs nothing but the
   account; UPS/FedEx want their own credentials), and set **`SHIPPO_API_KEY`**.
   Use a `shippo_test_…` token in Preview and Development and the live one in
   Production, exactly as the Stripe keys are mapped.
2. **Fill in the ship-from address** under `/studio` → **Settings** →
   **Shipping**. Until it is complete the panel says so and buys nothing.

Nothing to add in Notion: `Tracking Number`, `Carrier` and `Tracking URL`
already exist on shop orders, and the app has read all three since the
fulfilment card. Nothing to migrate, and unset ⇒ the dashboard behaves exactly
as it did before.

## Known limits

- **Shop orders only.** A custom order isn't bought through the cart, so it has
  no Stripe session and therefore no structured address; posting one is still
  done by hand. Extending it means a `Ship-to Address` on Custom Orders that the
  atelier fills in, plus a typed-address form as the fallback — a second,
  hand-keyed path better built once this one is proven.
- **No void or refund of a bought label.** Shippo can refund an unused label,
  and this doesn't offer it; a mistake is voided in the Shippo dashboard, and
  the replacement is bought here with `replace`.
- **No packing slip, no manifest, no batch.** One order, one parcel, one label.
  A day's posting is done one order at a time.
- **No address validation.** Shippo offers it; the carrier's own rejection at
  rate time is the check today, plus the envelope lines the panel shows before
  anything is paid for.
- **The rate id expires.** A quote read and left for a long while will be
  refused at purchase; the panel surfaces the vendor's own "the rate has
  expired" and the fix is to ask for rates again.
