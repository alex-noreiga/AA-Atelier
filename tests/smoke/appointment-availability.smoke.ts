import { test, expect } from "@playwright/test";

// The DEEP appointment smoke: unlike `appointments.smoke.ts` (which only proves
// the static `/api/appointments/options` catalog rendered), this exercises
// `GET /api/appointments/availability` — the endpoint that actually reads each
// staff member's Google Calendar free/busy AND the working-hours Google Sheet.
// That's exactly where a Google outage, an expired/mis-scoped service-account
// key, an unshared Sheet, or a lapsed domain-wide delegation surfaces, and none
// of the other specs touch it.
//
// Driven through the API request context (no browser) rather than the fragile
// four-step booking UI, and strictly READ-ONLY: it lists open times but never
// picks a slot or POSTs a booking, so nothing is written to Google Calendar and
// no email is sent. Zero open slots is a HEALTHY answer (the atelier may be
// fully booked or off) — only a non-200, or a shape that isn't a slot list,
// is the regression signal.

test.describe("Production smoke: appointment availability", () => {
  test("live availability read answers for a real type/location", async ({
    request,
  }) => {
    // First read the live catalog to pick a real type + one of its locations,
    // so we never hardcode an id the atelier might rename.
    const optionsRes = await request.get("/api/appointments/options");
    expect(optionsRes.status()).toBe(200);
    const options = (await optionsRes.json()) as {
      types: { id: string; locations: string[] }[];
    };
    expect(Array.isArray(options.types)).toBe(true);
    expect(options.types.length).toBeGreaterThan(0);

    const type = options.types[0];
    const location = type.locations[0];
    expect(location).toBeTruthy();

    // The real availability computation: config working hours (Sheet) minus
    // Google Calendar free/busy. A 200 with a slots array means both external
    // reads succeeded end to end.
    const availRes = await request.get("/api/appointments/availability", {
      params: { typeId: type.id, location },
    });
    expect(
      availRes.status(),
      `availability returned ${availRes.status()} for type=${type.id} location=${location}`,
    ).toBe(200);

    const body = (await availRes.json()) as {
      timezone?: string;
      slots?: unknown[];
    };
    // Shape check — an empty slots array is fine (fully booked / off), a missing
    // array is not (that's a broken read, not a full calendar).
    expect(Array.isArray(body.slots)).toBe(true);
    expect(typeof body.timezone).toBe("string");
  });
});
