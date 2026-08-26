// A postal address in its parts, and the rules for deciding whether one is
// complete enough to put on a parcel. Pure: no vendor, no HTTP, no env.
//
// The whole point of this module is that an address is STRUCTURED here and
// nowhere else in the shipping flow. The app has carried a shipping address on
// shop orders since checkout shipped, but as a single display line built by
// `formatShippingAddress` for a human to read — "12 Rink Rd, Apt 4, Austin TX
// 78701, US". Reading that back into components is guesswork: the comma between
// "Austin TX 78701" and the country is a different kind of comma from the one
// after "Apt 4", a two-word city breaks the state heuristic, and an address line
// with a comma in it breaks everything. A guessed address is a parcel that
// doesn't arrive, so the label flow never parses one — it reads the components
// Stripe already collected. See `services/shipping-label.service.ts`.

/** An address in the parts a carrier needs, ISO-3166 alpha-2 country. */
export interface PostalAddress {
  name: string;
  street1: string;
  street2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone?: string;
  email?: string;
}

/** Blank-safe trim: "" and whitespace read as absent. */
function text(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Build an address from loose parts, dropping the blanks.
 *
 * Everything optional is omitted rather than sent as `""` — a carrier reads an
 * empty `street2` as a line to print, and an empty phone as a phone.
 */
export function toPostalAddress(parts: {
  name?: string | null;
  street1?: string | null;
  street2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  country?: string | null;
  phone?: string | null;
  email?: string | null;
}): PostalAddress {
  return {
    name: text(parts.name) ?? "",
    street1: text(parts.street1) ?? "",
    city: text(parts.city) ?? "",
    state: (text(parts.state) ?? "").toUpperCase(),
    zip: text(parts.zip) ?? "",
    // Carriers key rating on the country code, and a lowercase "us" is a
    // different string to every one of them. Normalized once, here.
    country: (text(parts.country) ?? "").toUpperCase(),
    ...(text(parts.street2) ? { street2: text(parts.street2)! } : {}),
    ...(text(parts.phone) ? { phone: text(parts.phone)! } : {}),
    ...(text(parts.email) ? { email: text(parts.email)! } : {}),
  };
}

/**
 * Which required parts of an address are missing, phrased for the atelier.
 *
 * Returned as a LIST rather than a boolean because this is the message the
 * dashboard shows when a label can't be bought, and "the address is incomplete"
 * sends somebody hunting. `what` names whose address it is ("the studio's
 * ship-from address" / "the customer's address"), since the two failures have
 * completely different fixes: one is a Studio Setting, the other is a checkout
 * that collected less than it should have.
 *
 * `state` is deliberately NOT required outside the US: plenty of countries have
 * no state or province in their address format, and demanding one would refuse a
 * perfectly good address. Inside the US it is required, because a carrier can't
 * rate a domestic parcel without it.
 */
export function addressProblems(
  address: PostalAddress,
  what: string,
): string[] {
  const missing: string[] = [];
  if (!address.name) missing.push("a name");
  if (!address.street1) missing.push("a street address");
  if (!address.city) missing.push("a city");
  if (!address.zip) missing.push("a postal code");
  if (!address.country) missing.push("a country");
  if (address.country === "US" && !address.state) missing.push("a state");

  if (missing.length === 0) return [];
  const list =
    missing.length === 1
      ? missing[0]
      : `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}`;
  return [`${what} is missing ${list}.`];
}

/** True when every required part is present. */
export function addressIsComplete(address: PostalAddress): boolean {
  return addressProblems(address, "x").length === 0;
}

/**
 * The address as the lines you would write on an envelope, for showing the
 * atelier what they are about to post to before they spend money on it.
 */
export function formatAddressLines(address: PostalAddress): string[] {
  const locality = [address.city, address.state, address.zip]
    .filter(Boolean)
    .join(" ");
  return [
    address.name,
    address.street1,
    address.street2,
    locality,
    address.country,
  ].filter((line): line is string => Boolean(line && line.trim()));
}
