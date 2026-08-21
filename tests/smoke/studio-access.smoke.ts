import { test, expect } from "@playwright/test";

// The staff gate still refuses anonymous callers.
//
// Unlike every other spec here, this one monitors a REFUSAL rather than a
// success. `/studio` is the internal dashboard: order counts, production load,
// revenue by month, deposits vs. balances, best sellers — plus the tools that
// issue Stripe refunds. It is unlinked and `noindex`, so nothing on the public
// site would ever reveal a regression in its gate; a misconfigured
// STUDIO_STAFF_EMAILS, a `requireStaff` accidentally dropped from a route, or a
// deploy that shipped the dashboard without its middleware would all be
// completely silent from the outside. The failure mode is a data leak, which is
// exactly the kind that never announces itself.
//
// Read-only and unauthenticated by construction: we send no credentials and
// assert we are turned away. Nothing is written and no session is created.
//
// The expected answers come from the gate's deliberate three-way split (see
// CLAUDE.md, "Studio analytics dashboard"): 401 when not signed in, 404 when
// signed in but not staff (indistinguishable from a URL that doesn't exist, by
// design), 403 when staff but not signed in with Google. Anonymous means 401 —
// but the assertion that matters is simply "not 200 and not a 5xx", because any
// of the three refusals is safe while a 200 is a breach and a 500 means the gate
// errored rather than decided.

const GATED_ENDPOINTS = [
  {
    path: "/api/studio/access",
    what: "the staff probe behind the navbar's Dashboard link",
  },
  {
    path: "/api/studio/analytics",
    what: "the dashboard's revenue and order figures",
  },
  {
    path: "/api/studio/availability",
    what: "the staff working-hours editor",
  },
  {
    path: "/api/studio/reviews",
    what: "the review moderation queue",
  },
];

test.describe("Production smoke: studio staff gate", () => {
  for (const { path, what } of GATED_ENDPOINTS) {
    test(`${path} refuses an anonymous caller`, async ({ request }) => {
      const res = await request.get(path);
      const status = res.status();

      expect(
        status,
        `${path} (${what}) answered 200 to an ANONYMOUS request — the staff gate is not protecting it`,
      ).not.toBe(200);

      // A refusal, not a crash. A 5xx here means the gate threw instead of
      // deciding, which is its own regression (and would page the atelier via
      // the 500 alert email).
      expect(
        status,
        `${path} answered ${status} — the gate errored rather than refusing`,
      ).toBeLessThan(500);

      // One of the three documented refusals.
      expect(
        [401, 403, 404],
        `${path} answered an unexpected ${status}; expected one of 401 / 403 / 404`,
      ).toContain(status);
    });
  }

  // The dashboard route itself must not be advertised to crawlers. It is served
  // by the SPA catch-all (it is `noindex` and therefore deliberately NOT
  // prerendered), so this checks the sitemap rather than the page's own head.
  test("the dashboard is absent from the sitemap", async ({ request }) => {
    const res = await request.get("/sitemap.xml");
    expect(res.status()).toBe(200);

    const xml = await res.text();
    expect(
      xml.includes("/studio"),
      "/studio appeared in sitemap.xml — the noindex route is being advertised to crawlers",
    ).toBe(false);
    // The account portal is noindex for the same reason.
    expect(xml.includes("/account")).toBe(false);
  });
});
