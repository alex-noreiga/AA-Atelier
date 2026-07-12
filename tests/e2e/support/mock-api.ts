// Playwright route helpers that intercept the app's `/api/*` calls in the
// browser before they leave for the Vite proxy / backend. This keeps the e2e
// flows deterministic and offline — no running api-server, no live Notion
// writes — while still exercising the real frontend (routing, forms, the
// generated react-query client, and the rendered result).

import type { Page, Route } from "@playwright/test";

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });

export interface OrderStatusPayload {
  orderNumber: string;
  orderName: string;
  currentStage: string;
  stages: string[];
}

/**
 * Mock `GET /api/orders/:orderNumber`. Records the order numbers actually
 * requested so a test can assert client-side normalization (trim/uppercase).
 */
export async function mockOrderStatus(
  page: Page,
  opts: { status?: number; body: OrderStatusPayload | unknown },
): Promise<{ requestedOrderNumbers: string[] }> {
  const requestedOrderNumbers: string[] = [];
  await page.route("**/api/orders/*", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const url = new URL(route.request().url());
    requestedOrderNumbers.push(
      decodeURIComponent(url.pathname.split("/").pop() ?? ""),
    );
    await json(route, opts.status ?? 200, opts.body);
  });
  return { requestedOrderNumbers };
}

/** Mock `POST /api/orders`. */
export async function mockCreateOrder(
  page: Page,
  opts: { status?: number; body: unknown },
): Promise<void> {
  await page.route("**/api/orders", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await json(route, opts.status ?? 201, opts.body);
  });
}

/** Mock `POST /api/contact`. */
export async function mockCreateContact(
  page: Page,
  opts: { status?: number; body: unknown },
): Promise<void> {
  await page.route("**/api/contact", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await json(route, opts.status ?? 201, opts.body);
  });
}
