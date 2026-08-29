import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  addressIsComplete,
  addressProblems,
  formatAddressLines,
  toPostalAddress,
} from "../../src/lib/shipping/address.js";
import {
  shipFromAddress,
  shipFromProblems,
  SHIP_FROM_KEYS,
} from "../../src/lib/shipping/from-address.js";
import {
  __setSettingsSnapshot,
  __resetSettings,
} from "../../src/lib/settings/store.js";

const savedEnv = new Map<string, string | undefined>();

beforeEach(() => {
  __resetSettings();
  for (const key of SHIP_FROM_KEYS) {
    savedEnv.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(() => {
  __resetSettings();
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const COMPLETE = {
  name: "A.A Atelier",
  street1: "1200 Rink Road",
  city: "Austin",
  state: "TX",
  zip: "78701",
  country: "US",
};

describe("toPostalAddress", () => {
  it("uppercases the country and state so a carrier sees one spelling", () => {
    const address = toPostalAddress({
      ...COMPLETE,
      state: "tx",
      country: "us",
    });
    expect(address.state).toBe("TX");
    expect(address.country).toBe("US");
  });

  it("omits the optional parts rather than sending them blank", () => {
    // A carrier reads an empty street2 as a line to print and an empty phone as
    // a phone, so absent has to be absent rather than "".
    const address = toPostalAddress({ ...COMPLETE, street2: "  ", phone: "" });
    expect(address).not.toHaveProperty("street2");
    expect(address).not.toHaveProperty("phone");
  });

  it("keeps the optional parts when they're real", () => {
    const address = toPostalAddress({
      ...COMPLETE,
      street2: "Suite 4",
      phone: "512-555-0100",
      email: "hello@example.com",
    });
    expect(address.street2).toBe("Suite 4");
    expect(address.phone).toBe("512-555-0100");
    expect(address.email).toBe("hello@example.com");
  });
});

describe("addressProblems", () => {
  it("passes a complete address", () => {
    expect(addressProblems(toPostalAddress(COMPLETE), "x")).toEqual([]);
    expect(addressIsComplete(toPostalAddress(COMPLETE))).toBe(true);
  });

  it("names every missing part in one sentence, so nobody goes hunting", () => {
    const problems = addressProblems(
      toPostalAddress({ name: "A.A Atelier", country: "US" }),
      "The studio's address",
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("The studio's address is missing");
    expect(problems[0]).toContain("a street address");
    expect(problems[0]).toContain("a city");
    expect(problems[0]).toContain("a postal code");
    expect(problems[0]).toContain("a state");
  });

  it("requires a state inside the US, because no carrier will rate without one", () => {
    const problems = addressProblems(
      toPostalAddress({ ...COMPLETE, state: "" }),
      "x",
    );
    expect(problems[0]).toContain("a state");
  });

  it("does NOT require a state outside the US", () => {
    // Plenty of countries have no state or province in their address format;
    // demanding one would refuse a perfectly good address.
    expect(
      addressProblems(
        toPostalAddress({
          name: "A Skater",
          street1: "3 Rue du Patinoire",
          city: "Lyon",
          state: "",
          zip: "69001",
          country: "FR",
        }),
        "x",
      ),
    ).toEqual([]);
  });
});

describe("formatAddressLines", () => {
  it("reads as an envelope, so a wrong address is caught by eye", () => {
    expect(
      formatAddressLines(toPostalAddress({ ...COMPLETE, street2: "Suite 4" })),
    ).toEqual([
      "A.A Atelier",
      "1200 Rink Road",
      "Suite 4",
      "Austin TX 78701",
      "US",
    ]);
  });

  it("drops the lines that aren't there rather than printing blanks", () => {
    expect(formatAddressLines(toPostalAddress(COMPLETE))).toEqual([
      "A.A Atelier",
      "1200 Rink Road",
      "Austin TX 78701",
      "US",
    ]);
  });
});

describe("shipFromAddress", () => {
  it("reports every missing part when nothing is configured", () => {
    // Never throws and never returns null: the caller's next question is
    // "what's missing?", which an absent address can't answer.
    const problems = shipFromProblems();
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("Studio settings");
  });

  it("defaults the country to US, since that is the only account the studio can hold", () => {
    expect(shipFromAddress().country).toBe("US");
  });

  it("reads Notion settings ahead of the environment", () => {
    process.env.SHIP_FROM_CITY = "Dallas";
    __setSettingsSnapshot({ SHIP_FROM_CITY: "Austin" });
    expect(shipFromAddress().city).toBe("Austin");
  });

  it("falls through to the environment when no setting is stored", () => {
    process.env.SHIP_FROM_CITY = "Dallas";
    expect(shipFromAddress().city).toBe("Dallas");
  });

  it("is postable once every required key is set", () => {
    __setSettingsSnapshot({
      SHIP_FROM_NAME: "A.A Atelier",
      SHIP_FROM_STREET1: "1200 Rink Road",
      SHIP_FROM_CITY: "Austin",
      SHIP_FROM_STATE: "TX",
      SHIP_FROM_ZIP: "78701",
    });
    expect(shipFromProblems()).toEqual([]);
  });
});
