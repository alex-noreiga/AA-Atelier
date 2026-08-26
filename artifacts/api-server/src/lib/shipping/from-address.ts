// Where the studio's parcels are posted FROM — the return address printed on
// every label, and the origin every rate is quoted against.
//
// Seven Studio Settings keys rather than one, and that is deliberate. The
// alternative — a single `SHIP_FROM_ADDRESS` typed as a line and split back
// apart here — is exactly the parsing `lib/shipping/address.ts` exists to avoid,
// and it would fail at the worst possible moment: an origin postcode read wrong
// misprices every rate in the list, silently, in a direction nobody checks.
// Seven typed fields also mean the settings editor validates each one and the
// dashboard can say which is missing.
//
// Non-secret and atelier-editable, so Studio Settings is the right home
// (Notion → env → default, like every other tunable). The studio's address
// changes rarely, but when it does it must not need a deploy — and the default
// is deliberately EMPTY: there is no sensible built-in for somebody's address,
// and a made-up one would print on a real parcel.

import { settingValue } from "../settings/store.js";
import {
  addressProblems,
  toPostalAddress,
  type PostalAddress,
} from "./address.js";

/** The Studio Settings / env keys this reads, in the order the editor shows them. */
export const SHIP_FROM_KEYS = [
  "SHIP_FROM_NAME",
  "SHIP_FROM_STREET1",
  "SHIP_FROM_STREET2",
  "SHIP_FROM_CITY",
  "SHIP_FROM_STATE",
  "SHIP_FROM_ZIP",
  "SHIP_FROM_COUNTRY",
  "SHIP_FROM_PHONE",
] as const;

/** The country used when the atelier hasn't set one. The studio is in the US and
 * every carrier account it can hold is a US one, so this saves a field rather
 * than guessing at anything. */
export const DEFAULT_SHIP_FROM_COUNTRY = "US";

function setting(key: (typeof SHIP_FROM_KEYS)[number]): string | undefined {
  return settingValue(key) ?? process.env[key];
}

/**
 * The studio's ship-from address, as far as it has been filled in.
 *
 * Always returns an object — never null — because the caller's next question is
 * "what's missing?", and an absent address can't answer it. Use
 * {@link shipFromProblems} to find out whether it can be posted from.
 */
export function shipFromAddress(): PostalAddress {
  return toPostalAddress({
    name: setting("SHIP_FROM_NAME"),
    street1: setting("SHIP_FROM_STREET1"),
    street2: setting("SHIP_FROM_STREET2"),
    city: setting("SHIP_FROM_CITY"),
    state: setting("SHIP_FROM_STATE"),
    zip: setting("SHIP_FROM_ZIP"),
    country: setting("SHIP_FROM_COUNTRY") || DEFAULT_SHIP_FROM_COUNTRY,
    phone: setting("SHIP_FROM_PHONE"),
  });
}

/**
 * Why no label can be bought from this address yet, or an empty list when it can.
 *
 * Named as the studio's own so the fix is obvious: this is a Studio Setting to
 * fill in, not something wrong with the customer's order — the two failures read
 * almost identically at the point of sale and have nothing in common to do about
 * them.
 */
export function shipFromProblems(
  address: PostalAddress = shipFromAddress(),
): string[] {
  return addressProblems(
    address,
    "The studio's ship-from address (under Studio settings)",
  );
}
