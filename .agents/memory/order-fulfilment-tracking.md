---
name: Order tracking — carrier tracking and local pickup
description: One `OrderFulfilment` shape answers "where is my order?" for custom and shop orders alike, with a local-pickup variant for the customers who collect in person and so never get a tracking number.
---

# Order tracking: shipping and local pickup

Roadmap card ① ("Custom-order tracking for the customer") plus the gap the owner
raised alongside it: **local customers collect in person**, so their order has no
tracking number and never will. A page whose only shipping affordance is a
tracking panel tells that customer nothing — and a panel that stays empty forever
reads as the site being broken rather than as "there is nothing to track".

## What shipped

- `OrderFulfilment` in the OpenAPI contract, carried by **both** `OrderStatus`
  and `ShopOrderStatus`. It **replaced** `ShopOrderStatus.tracking` rather than
  sitting beside it — one shape, one component, no chance of the two order kinds
  answering the same question differently.
- `artifacts/api-server/src/lib/fulfilment.ts` — the pure resolver both services
  call (`resolveDeliveryMethod` / `resolveFulfilment`).
- Custom orders read eight columns they never read before
  (`extractFulfilmentFields` in `orders.schema.ts`); shop orders read the same
  set bar `Fulfilment` (`readFulfilmentFields` in `shop-orders.repository.ts`).
- `web-app/src/components/fulfilment-panel.tsx` + `lib/fulfilment-format.ts`,
  rendered below the timeline by `custom-order-result.tsx` and
  `shop-order-result.tsx`.

- `chosePickupRate` in `shop-orders.blocks.ts` — the one **write**: a shop order
  paid with the atelier's local-pickup Stripe shipping rate marks itself.

**No new env var, no new database, and nothing the atelier must do before the
deploy is safe.** Three of those columns already existed on Custom Orders —
`Fulfilment`, `Ship By` and `Tracking Number`, exactly the "fields the app never
reads" the roadmap card named.

## The decisions worth keeping

1. **A label with nothing behind it loses to a fact.** The declared
   `Delivery Method` decides ship vs pickup — _unless_ the order carries the
   facts of the other kind and none of its own: a "Ship" order with a pickup time
   and no tracking is a pickup, and a "Local pickup" order with a tracking number
   and no pickup details is a shipment. The failure this exists for is a
   **database template that pre-sets the method on every new order**; whichever
   way that default is wrong, the first real fact the atelier enters corrects it.
   Unset ⇒ inferred the same way, defaulting to `ship`, so an untouched order
   behaves exactly as it did before pickup existed.

2. **`Ship By` is deliberately not a shipping fact.** On a pickup order the
   atelier reads that column as "ready by", so counting it in the inference would
   flip every scheduled collection back to a shipment.

3. **A pickup order always has something to say; a shipped one has to earn it.**
   That the order _is_ a pickup is itself the answer to "why is there no tracking
   number?", so the panel shows even before a time is arranged ("We'll arrange a
   pickup time with you"). A shipped order shows nothing until there's a tracking
   number, a ship-by date, or a handoff state — an empty shipping panel on a
   garment still being sewn is noise.

4. **The ship-by date is dropped the moment it stops being true.** Once a
   tracking number exists (or the order reaches its final stage) the tracking is
   the answer, and a past "expected to ship by" reads as a broken promise rather
   than as history. The handoff state goes at the final stage for the same
   reason. The tracking number itself is **never** dropped — a delivered order
   still wants its link.

5. **The customer's own address is never returned.** `Ship-to Address` /
   `Shipping Address` are read by neither repository, and both have a comment
   saying so: the tracking lookup is gated by **order number alone**, so echoing
   the address back would hand a customer's home address to anyone holding their
   order number. The pickup **location** is the studio's own address, which is
   why that one is safe.

6. **`Fulfilment` is now read — but still never as completion.** This corrects
   `order-stage-vs-fulfilment.md`, which said the select was referenced nowhere
   in code. It's surfaced as advisory copy about the shipping leg only; `Stage`
   remains the single positional source of truth for "is it done?", and the
   server drops the state entirely once the order is delivered so the two can't
   contradict each other at the finish.

7. **The state is said in customer words, with the atelier's own word as the
   fallback.** `fulfilmentStateNote` maps the four live options per method
   ("Packed" → "Packed and ready to send." / "…ready for you to collect.") and
   falls back to the raw value for an option the atelier invents — the same
   graceful-fallback contract as `stage-descriptions.ts`. Cosmetic; renaming an
   option costs the sentence, not the panel.

8. **A pickup time is an instant; a ship-by is a calendar day.** A pickup
   datetime is rendered in the studio's `APPOINTMENT_TIMEZONE` (carried on the
   response as `pickup.timezone`, same contract as `AppointmentDetails.timezone`)
   so a customer in another state is told the studio's local time. A **bare**
   pickup date has no zone attached and goes through `formatDate`, which pins it
   to UTC — parsed as UTC midnight and formatted in a western zone it would
   otherwise slip to the day before. `shipBy` is reduced to its first 10
   characters server-side for the same reason.

## Atelier setup (all optional, all additive)

Add to **Custom Orders** and **shop orders** alike:

| Property          | Type                         | Why                                             |
| ----------------- | ---------------------------- | ----------------------------------------------- |
| `Delivery Method` | select — Ship / Local pickup | Says which panel the customer sees              |
| `Pickup Time`     | date (**include time**)      | The scheduled collection                        |
| `Pickup Location` | text                         | Where to collect (the studio's address, a rink) |

Custom Orders may also gain **`Carrier`** (text) and **`Tracking URL`** (url) to
match shop orders — the app already reads both there; until they exist a custom
order's tracking number simply shows unlinked and unlabelled.

Nothing is written by the app, so a missing property costs only the thing it
would have said (reading a property Notion doesn't have is safe — only _writing_
one 400s the whole page). Leaving `Delivery Method` unset works too: scheduling a
`Pickup Time` is enough to make an order read as a pickup.

9. **A shop customer chooses pickup at checkout, and the order marks itself.**
   The atelier added a **local-pickup Stripe shipping rate** (an ordinary
   `shr_…` in `STRIPE_SHIPPING_RATE_IDS`), and `chosePickupRate` writes
   `Delivery Method = "Local pickup"` on the Notion order when that's the rate
   the customer chose. Decided from the rate's **display name** through the same
   `looksLikePickup` the Notion select goes through — one vocabulary, so the rate
   the customer picks and the column the atelier reads can't disagree. The name
   **not the id**: ids are mode-scoped, so pinning to one would mean a second env
   var to keep in step with `STRIPE_SHIPPING_RATE_IDS` across two Stripe modes,
   silently breaking the day a rate is replaced. A posted rate writes nothing (an
   order with no method reads as a shipment anyway). Needs
   `shipping_cost.shipping_rate` expanded on the webhook's session retrieve.

   This is the **only** write in the feature, and it forced one refactor:
   `createPageDroppingUnknownProperties` moved out of `orders.repository.ts` into
   `lib/notion/create-page.ts` so `createShopOrder` shares it. That write lands on
   the **Stripe webhook**, where a 400 over an un-added `Delivery Method` would
   lose a **paid** order — and the redelivery would fail identically.

## Known limits

- **A custom order's method is still set by hand.** It isn't bought through the
  cart, so there is no rate to read; the atelier sets `Delivery Method` (or just
  a `Pickup Time`) on the order.
- **No pickup reminder email.** The day-before appointment sweep covers Google
  Calendar bookings, not pickup times on an order; a pickup slot is only visible
  on the tracking page and in whatever the atelier sends by hand.
- **The account portal doesn't show any of this.** `OrderSummary` is deliberately
  lightweight and its cards link out to `/track`.
