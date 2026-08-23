import { describe, it, expect } from "vitest";
import {
  resolveDeliveryMethod,
  resolveFulfilment,
} from "../../src/lib/fulfilment.js";

const TZ = "America/Chicago";
const ctx = { timezone: TZ };

describe("resolveDeliveryMethod", () => {
  it("defaults to shipping when nothing is set", () => {
    // An order the atelier hasn't touched must behave exactly as it did before
    // pickup existed.
    expect(resolveDeliveryMethod({})).toBe("ship");
  });

  it("honours the declared method, however the atelier worded the option", () => {
    for (const method of [
      "Local pickup",
      "local-pickup",
      "Pick up",
      "Customer collects",
      "PICKUP",
    ]) {
      expect(resolveDeliveryMethod({ method })).toBe("pickup");
    }
    for (const method of ["Ship", "Shipping", "Mail", "Courier delivery"]) {
      expect(resolveDeliveryMethod({ method })).toBe("ship");
    }
  });

  it("ignores a method it doesn't recognize and infers instead", () => {
    expect(resolveDeliveryMethod({ method: "TBD" })).toBe("ship");
    expect(
      resolveDeliveryMethod({ method: "TBD", pickupAt: "2026-09-03" }),
    ).toBe("pickup");
  });

  it("infers pickup from a scheduled time or a location", () => {
    expect(resolveDeliveryMethod({ pickupAt: "2026-09-03" })).toBe("pickup");
    expect(resolveDeliveryMethod({ pickupLocation: "The studio" })).toBe(
      "pickup",
    );
  });

  it("lets a fact outrank a label with nothing behind it, both ways", () => {
    // The failure this exists for is a database template that pre-sets the
    // method on every new order: whichever way it's wrong, the first real fact
    // the atelier enters corrects it.
    expect(
      resolveDeliveryMethod({
        method: "Ship",
        pickupAt: "2026-09-03T14:00:00Z",
      }),
    ).toBe("pickup");
    expect(
      resolveDeliveryMethod({
        method: "Local pickup",
        trackingNumber: "9400111899",
      }),
    ).toBe("ship");
  });

  it("keeps the declared method once its own facts back it up", () => {
    expect(
      resolveDeliveryMethod({
        method: "Local pickup",
        trackingNumber: "9400111899",
        pickupAt: "2026-09-03T14:00:00Z",
      }),
    ).toBe("pickup");
  });

  it("does not treat a ship-by date as a shipping fact", () => {
    // On a pickup order the atelier reads "Ship By" as "ready by"; counting it
    // would flip every scheduled collection back to a shipment.
    expect(
      resolveDeliveryMethod({ method: "Local pickup", shipBy: "2026-09-01" }),
    ).toBe("pickup");
  });
});

describe("resolveFulfilment — shipping", () => {
  it("says nothing when the atelier has entered nothing", () => {
    expect(resolveFulfilment({}, ctx)).toBeUndefined();
  });

  it("surfaces the tracking number, carrier and url", () => {
    expect(
      resolveFulfilment(
        {
          trackingNumber: "9400111899",
          carrier: "USPS",
          trackingUrl: "https://tools.usps.com/track",
        },
        ctx,
      ),
    ).toEqual({
      method: "ship",
      tracking: {
        number: "9400111899",
        carrier: "USPS",
        url: "https://tools.usps.com/track",
      },
    });
  });

  it("drops a carrier or url with no tracking number behind it", () => {
    expect(
      resolveFulfilment({ carrier: "USPS", trackingUrl: "https://x" }, ctx),
    ).toBeUndefined();
  });

  it("shows the ship-by date until the order actually ships", () => {
    expect(resolveFulfilment({ shipBy: "2026-09-01" }, ctx)).toEqual({
      method: "ship",
      shipBy: "2026-09-01",
    });

    // Once it's in the post the tracking is the answer; keeping the date would
    // have the page promise a send date for a parcel already gone.
    expect(
      resolveFulfilment(
        { shipBy: "2026-09-01", trackingNumber: "9400111899" },
        ctx,
      ),
    ).toEqual({
      method: "ship",
      tracking: { number: "9400111899" },
    });
  });

  it("reduces a ship-by datetime to its calendar date", () => {
    expect(
      resolveFulfilment({ shipBy: "2026-09-01T17:30:00.000-05:00" }, ctx),
    ).toEqual({ method: "ship", shipBy: "2026-09-01" });
  });

  it("shows the handoff state on its own when that's all there is", () => {
    expect(resolveFulfilment({ state: "Shipped" }, ctx)).toEqual({
      method: "ship",
      state: "Shipped",
    });
  });

  it("drops the ship-by date and the handoff state once delivered", () => {
    expect(
      resolveFulfilment(
        { shipBy: "2026-09-01", state: "Packed" },
        { ...ctx, delivered: true },
      ),
    ).toBeUndefined();

    // …but never the tracking itself: a delivered order still wants its link.
    expect(
      resolveFulfilment(
        { shipBy: "2026-09-01", state: "Packed", trackingNumber: "94001" },
        { ...ctx, delivered: true },
      ),
    ).toEqual({ method: "ship", tracking: { number: "94001" } });
  });
});

describe("resolveFulfilment — local pickup", () => {
  it("always has something to say, even before a time is arranged", () => {
    // That the order is a pickup at all is the answer to "why is there no
    // tracking number?".
    expect(resolveFulfilment({ method: "Local pickup" }, ctx)).toEqual({
      method: "pickup",
      pickup: {},
    });
  });

  it("carries the time, the place, and the zone to read the time in", () => {
    expect(
      resolveFulfilment(
        {
          method: "Local pickup",
          pickupAt: "2026-09-03T14:00:00.000-05:00",
          pickupLocation: "The studio — 12 Rink Road",
        },
        ctx,
      ),
    ).toEqual({
      method: "pickup",
      pickup: {
        at: "2026-09-03T14:00:00.000-05:00",
        location: "The studio — 12 Rink Road",
        timezone: TZ,
      },
    });
  });

  it("omits the timezone for a day with no time on it", () => {
    // A bare date is a calendar day, not an instant — a zone would only invite
    // the client to shift it.
    expect(
      resolveFulfilment(
        { method: "Local pickup", pickupAt: "2026-09-03" },
        ctx,
      ),
    ).toEqual({
      method: "pickup",
      pickup: { at: "2026-09-03" },
    });
  });

  it("never returns tracking on a pickup order", () => {
    const view = resolveFulfilment(
      {
        method: "Local pickup",
        pickupAt: "2026-09-03T14:00:00.000-05:00",
        trackingNumber: "9400111899",
      },
      ctx,
    );
    expect(view?.method).toBe("pickup");
    expect(view?.tracking).toBeUndefined();
    expect(view?.shipBy).toBeUndefined();
  });

  it("keeps the pickup details once collected, minus the handoff state", () => {
    expect(
      resolveFulfilment(
        {
          method: "Local pickup",
          pickupAt: "2026-09-03T14:00:00.000-05:00",
          state: "Delivered/Picked up",
        },
        { ...ctx, delivered: true },
      ),
    ).toEqual({
      method: "pickup",
      pickup: { at: "2026-09-03T14:00:00.000-05:00", timezone: TZ },
    });
  });

  it("treats blank and whitespace-only values as unset", () => {
    expect(
      resolveFulfilment(
        { method: "Local pickup", pickupLocation: "   ", pickupAt: "" },
        ctx,
      ),
    ).toEqual({ method: "pickup", pickup: {} });
  });
});
