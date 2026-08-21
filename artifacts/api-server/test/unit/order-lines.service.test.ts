import { describe, it, expect, vi } from "vitest";

// The repository is the only I/O this service does; mock it so the tests stay
// pure (no Notion) and can drive the skip/failure branches.
vi.mock("../../src/lib/notion/order-lines.repository.js", () => ({
  createOrderLine: vi.fn(),
  orderLinesConfigured: vi.fn(),
}));

import type Stripe from "stripe";
import {
  purchasedLinesFromSession,
  recordShopOrderLines,
} from "../../src/services/order-lines.service.js";
import {
  createOrderLine,
  orderLinesConfigured,
} from "../../src/lib/notion/order-lines.repository.js";
import { logger } from "../../src/lib/logger.js";

const mockCreate = vi.mocked(createOrderLine);
const mockConfigured = vi.mocked(orderLinesConfigured);

/** A Stripe line item as the webhook sees it once the session is retrieved with
 * `expand: ["line_items.data.price.product"]`. */
function line(
  overrides: {
    variantId?: string;
    size?: string;
    quantity?: number;
    unitAmount?: number | null;
    amountSubtotal?: number;
    description?: string;
    /** Simulate an unexpanded product (a bare id string). */
    unexpanded?: boolean;
  } = {},
): Stripe.LineItem {
  const {
    variantId = "inv-1",
    size,
    quantity = 1,
    unitAmount = 2200,
    amountSubtotal = 2200,
    description = "Bow Fleece Soaker",
    unexpanded = false,
  } = overrides;

  const metadata: Record<string, string> = {};
  if (variantId) metadata.variantId = variantId;
  if (size) metadata.size = size;

  return {
    description,
    quantity,
    amount_subtotal: amountSubtotal,
    amount_total: amountSubtotal,
    price: {
      unit_amount: unitAmount,
      product: unexpanded ? "prod_123" : { metadata },
    },
  } as unknown as Stripe.LineItem;
}

function session(lines: Stripe.LineItem[]): Stripe.Checkout.Session {
  return {
    id: "cs_test_1",
    line_items: { data: lines },
  } as unknown as Stripe.Checkout.Session;
}

describe("purchasedLinesFromSession", () => {
  it("maps each expanded line to its inventory id, quantity, unit price and size", () => {
    const { lines, skipped } = purchasedLinesFromSession(
      session([
        line({ variantId: "inv-1", size: "Adult M", quantity: 2 }),
        line({
          variantId: "inv-2",
          quantity: 1,
          unitAmount: 1200,
          description: "Blade Towel",
        }),
      ]),
    );

    expect(skipped).toBe(0);
    expect(lines).toEqual([
      {
        itemPageId: "inv-1",
        name: "Bow Fleece Soaker",
        quantity: 2,
        unitPrice: 22,
        size: "Adult M",
      },
      {
        itemPageId: "inv-2",
        name: "Blade Towel",
        quantity: 1,
        unitPrice: 12,
      },
    ]);
  });

  it("skips (and counts) a line whose product carries no inventory id", () => {
    const { lines, skipped } = purchasedLinesFromSession(
      session([line({ unexpanded: true }), line({ variantId: "inv-9" })]),
    );

    expect(skipped).toBe(1);
    expect(lines).toHaveLength(1);
    expect(lines[0].itemPageId).toBe("inv-9");
  });

  it("falls back to the pre-tax subtotal per unit when Stripe kept no unit price", () => {
    const { lines } = purchasedLinesFromSession(
      session([line({ unitAmount: null, quantity: 3, amountSubtotal: 6600 })]),
    );

    expect(lines[0].unitPrice).toBe(22);
  });

  it("returns nothing for a session with no line items", () => {
    expect(
      purchasedLinesFromSession({ id: "cs_1" } as Stripe.Checkout.Session),
    ).toEqual({ lines: [], skipped: 0 });
  });
});

describe("recordShopOrderLines", () => {
  it("writes one line per purchased item, tied to the order page", async () => {
    mockConfigured.mockReturnValue(true);

    const written = await recordShopOrderLines(
      session([
        line({ variantId: "inv-1", size: "Adult M", quantity: 2 }),
        line({ variantId: "inv-2", quantity: 1 }),
      ]),
      "order-page",
    );

    expect(written).toBe(2);
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        orderPageId: "order-page",
        itemPageId: "inv-1",
      }),
    );
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        orderPageId: "order-page",
        itemPageId: "inv-2",
      }),
    );
  });

  it("no-ops when the order-lines database is not configured", async () => {
    mockConfigured.mockReturnValue(false);

    await expect(
      recordShopOrderLines(session([line()]), "order-page"),
    ).resolves.toBe(0);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("keeps going (and never throws) when one line fails to write", async () => {
    mockConfigured.mockReturnValue(true);
    const error = vi.spyOn(logger, "error").mockImplementation(() => {});
    mockCreate
      .mockRejectedValueOnce(new Error("Notion 503"))
      .mockResolvedValueOnce(undefined);

    const written = await recordShopOrderLines(
      session([line({ variantId: "inv-1" }), line({ variantId: "inv-2" })]),
      "order-page",
    );

    expect(written).toBe(1);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("warns about lines it could not resolve to an inventory row", async () => {
    mockConfigured.mockReturnValue(true);
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});

    await recordShopOrderLines(
      session([line({ unexpanded: true })]),
      "order-page",
    );

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ skipped: 1 }),
      expect.stringContaining("will not decrement stock"),
    );
    expect(mockCreate).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
