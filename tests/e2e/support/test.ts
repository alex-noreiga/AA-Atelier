// Extended Playwright `test` that fails any spec which makes an `/api/*` call
// it did not explicitly mock.
//
// Every e2e spec is meant to intercept every `/api/*` call in the browser (see
// `mock-api.ts`) so the runs are offline and deterministic. Without a guard, an
// unmocked endpoint silently falls through to the Vite proxy — a hang, or a real
// network call — which reads as a mysterious timeout rather than "you forgot to
// mock this". This fixture makes that case loud.
//
// How it stays out of the way of real mocks: Playwright routes are last-in,
// first-out, and this guard is registered in the `page` fixture *before* the
// test body runs, so any per-test mock registered later takes priority. Only a
// request no handler matched (or one a handler `fallback()`ed on, e.g. a wrong
// method) reaches the guard. The guard records it and returns a 599 so the app
// gets a definite (failing) response instead of hanging, then asserts in
// teardown that nothing was recorded.
//
// Import `test`/`expect` from here instead of `@playwright/test` in every spec.

import { test as base, expect } from "@playwright/test";

export const test = base.extend({
  page: async ({ page }, use) => {
    const unmocked: string[] = [];

    await page.route("**/api/**", (route) => {
      const req = route.request();
      unmocked.push(`${req.method()} ${new URL(req.url()).pathname}`);
      return route.fulfill({
        status: 599,
        contentType: "application/json",
        body: JSON.stringify({ error: "Unmocked API call" }),
      });
    });

    await use(page);

    expect(
      unmocked,
      `Spec made ${unmocked.length} unmocked /api call(s): ${unmocked.join(", ")}. ` +
        `Add a matching mock in the test (see support/mock-api.ts).`,
    ).toEqual([]);
  },
});

export { expect };
