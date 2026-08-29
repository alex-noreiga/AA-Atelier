// Recording a payment that arrived outside Stripe.
//
// The interesting behavior is not the row — it is the two rules around it: the
// stage settles on the Notion invoice only once the LEDGER covers its amount
// (so a deposit taken as two piles of cash flips the checkbox on the second,
// not the first), and a date is anchored at midday in the studio's timezone so
// it can't slip to the neighbouring day when read back.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/lib/notion/orders.repository.js", () => ({
  findOrderByNumber: vi.fn(),
}));
vi.mock("../../src/lib/notion/shop-orders.repository.js", () => ({
  findShopOrderByNumber: vi.fn(),
}));
vi.mock("../../src/lib/notion/invoice.repository.js", () => ({
  findInvoice: vi.fn(),
  listInvoiceLineItems: vi.fn(),
  markInvoicePaid: vi.fn(),
}));
vi.mock("../../src/lib/db/payments.repository.js", () => ({
  recordPaymentEntry: vi.fn(),
  listOrderPayments: vi.fn(),
}));

import { recordOfflinePayment } from "../../src/services/payment-record.service.js";
import { BadRequestError, NotFoundError } from "../../src/lib/errors.js";
import { findOrderByNumber } from "../../src/lib/notion/orders.repository.js";
import { findShopOrderByNumber } from "../../src/lib/notion/shop-orders.repository.js";
import {
  findInvoice,
  markInvoicePaid,
} from "../../src/lib/notion/invoice.repository.js";
import {
  recordPaymentEntry,
  listOrderPayments,
  type PaymentRecord,
} from "../../src/lib/db/payments.repository.js";
import type { OrderRecord } from "../../src/lib/notion/orders.schema.js";
import type { InvoiceRecord } from "../../src/lib/notion/invoice.schema.js";

const mockOrder = vi.mocked(findOrderByNumber);
const mockShop = vi.mocked(findShopOrderByNumber);
const mockInvoice = vi.mocked(findInvoice);
const mockMarkPaid = vi.mocked(markInvoicePaid);
const mockWrite = vi.mocked(recordPaymentEntry);
const mockList = vi.mocked(listOrderPayments);

function order(): OrderRecord {
  return {
    pageId: "order-page",
    orderNumber: "ORD-000002",
    orderName: "Ada – Custom Costume",
    invoicePageId: "inv-1",
  } as unknown as OrderRecord;
}

function invoice(overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    pageId: "inv-1",
    invoiceId: "ORD-000002",
    ready: true,
    balancePaid: false,
    deposits: [
      {
        stage: "first_deposit",
        label: "First deposit",
        amount: 250,
        paid: false,
      },
    ],
    ...overrides,
  } as InvoiceRecord;
}

function ledgerRow(overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    id: "1",
    orderNumber: "ORD-000002",
    orderKind: "custom",
    stage: "first_deposit",
    kind: "charge",
    amountCents: 25000,
    currency: "usd",
    method: "cash",
    paidAt: new Date("2026-08-14T17:00:00.000Z"),
    externalId: "",
    paymentIntentId: "",
    note: "",
    recordedBy: "",
    ...overrides,
  };
}

beforeEach(() => {
  process.env.POSTGRES_URL = "postgres://localhost/test";
  process.env.APPOINTMENT_TIMEZONE = "America/Chicago";
  mockWrite.mockResolvedValue(true);
  mockList.mockResolvedValue([]);
  mockOrder.mockResolvedValue(order());
  mockInvoice.mockResolvedValue(invoice());
});

afterEach(() => {
  delete process.env.POSTGRES_URL;
  delete process.env.APPOINTMENT_TIMEZONE;
});

const base = {
  orderNumber: "ORD-000002",
  amount: 250,
  method: "cash" as const,
  stage: "first_deposit" as const,
  paidOn: "2026-08-14",
};

describe("validation, before anything is written", () => {
  it("rejects a blank order number", async () => {
    await expect(
      recordOfflinePayment({ ...base, orderNumber: "  " }),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("rejects $0, NaN and Infinity — each a payment that isn't one", async () => {
    // The generated schema only promises a non-negative number, so all three
    // reach the service.
    for (const amount of [0, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(
        recordOfflinePayment({ ...base, amount }),
      ).rejects.toBeInstanceOf(BadRequestError);
    }
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("rejects a figure large enough to be a stray digit", async () => {
    await expect(
      recordOfflinePayment({ ...base, amount: 250_000 }),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("rejects a future date — money cannot have arrived tomorrow", async () => {
    await expect(
      recordOfflinePayment({ ...base, paidOn: "2999-01-01" }),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("rejects a malformed date rather than guessing at it", async () => {
    await expect(
      recordOfflinePayment({ ...base, paidOn: "14/08/2026" }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });

  it("refuses to run at all with no ledger to write to", async () => {
    // Unlike every other Postgres caller this cannot degrade — the row is the
    // entire output, so there is nothing to report but the failure.
    delete process.env.POSTGRES_URL;
    await expect(recordOfflinePayment(base)).rejects.toThrow(
      /payment ledger isn't configured/,
    );
  });

  it("404s an order number nobody holds", async () => {
    mockOrder.mockResolvedValue(null);
    await expect(recordOfflinePayment(base)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it("requires a stage once the order has an invoice", async () => {
    await expect(
      recordOfflinePayment({ ...base, stage: undefined }),
    ).rejects.toThrow(/which payment this covers/i);
    expect(mockWrite).not.toHaveBeenCalled();
  });
});

describe("the date", () => {
  it("anchors a bare date at midday in the studio's timezone", async () => {
    // Midnight would be the trap: `2026-08-14` as UTC midnight, read back in a
    // western zone, is August 13 — and a payment silently moves a day, or a
    // month at a boundary.
    await recordOfflinePayment(base);

    const entry = mockWrite.mock.calls[0]?.[0];
    // 12:00 in America/Chicago (CDT, UTC-5) is 17:00Z.
    expect(entry?.paidAt.toISOString()).toBe("2026-08-14T17:00:00.000Z");
  });

  it("defaults to today when no date is given", async () => {
    await recordOfflinePayment({ ...base, paidOn: undefined });

    const entry = mockWrite.mock.calls[0]?.[0];
    expect(entry?.paidAt).toBeInstanceOf(Date);
    expect(entry?.paidAt.getTime()).toBeLessThanOrEqual(
      Date.now() + 24 * 60 * 60 * 1000,
    );
  });
});

describe("the row", () => {
  it("records the amount, method, stage and note against the order", async () => {
    await recordOfflinePayment({
      ...base,
      note: "  cash at the fitting  ",
      recordedBy: "alexandra@example.com",
    });

    expect(mockWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        orderNumber: "ORD-000002",
        orderKind: "custom",
        stage: "first_deposit",
        kind: "charge",
        amountCents: 25000,
        method: "cash",
        note: "cash at the fitting",
        recordedBy: "alexandra@example.com",
      }),
    );
  });

  it("carries no external id, so two identical cash payments are two rows", async () => {
    // The ledger's unique index is partial (`where external_id <> ''`), and this
    // is what exempts a hand-recorded payment from it.
    await recordOfflinePayment(base);

    expect(mockWrite.mock.calls[0]?.[0]).not.toHaveProperty("externalId");
  });
});

describe("settling the stage on the invoice", () => {
  it("marks the stage paid once the ledger covers it, with a BLANK session id", async () => {
    // Blank is the established encoding for "paid outside Stripe" — the refund
    // path already reads a paid stage with no session id as "refund manually".
    mockList.mockResolvedValue([ledgerRow()]);

    const result = await recordOfflinePayment(base);

    expect(mockMarkPaid).toHaveBeenCalledWith("inv-1", "first_deposit", "");
    expect(result.stageMarkedPaid).toBe(true);
    expect(result.stageOutstanding).toBe(0);
  });

  it("leaves a PART-paid stage unpaid, and says what is still outstanding", async () => {
    // The whole reason the checkbox is derived from the ledger rather than
    // ticked on sight: a hand-ticked box could never express the halfway state,
    // which is how a part-paid deposit came to read as settled.
    mockList.mockResolvedValue([ledgerRow({ amountCents: 10000 })]);

    const result = await recordOfflinePayment({ ...base, amount: 100 });

    expect(mockMarkPaid).not.toHaveBeenCalled();
    expect(result.stageMarkedPaid).toBe(false);
    expect(result.stageOutstanding).toBe(150);
  });

  it("settles on the SECOND instalment, counting what came before it", async () => {
    mockList.mockResolvedValue([
      ledgerRow({ amountCents: 10000 }),
      ledgerRow({ id: "2", amountCents: 15000 }),
    ]);

    const result = await recordOfflinePayment({ ...base, amount: 150 });

    expect(mockMarkPaid).toHaveBeenCalledWith("inv-1", "first_deposit", "");
    expect(result.stageMarkedPaid).toBe(true);
  });

  it("counts a Stripe charge toward the stage as readily as the cash", async () => {
    // A deposit part-paid by card and finished in cash must still settle.
    mockList.mockResolvedValue([
      ledgerRow({ amountCents: 20000, method: "stripe", externalId: "cs_1" }),
      ledgerRow({ id: "2", amountCents: 5000 }),
    ]);

    await recordOfflinePayment({ ...base, amount: 50 });

    expect(mockMarkPaid).toHaveBeenCalled();
  });

  it("ignores rows belonging to a different stage", async () => {
    mockList.mockResolvedValue([ledgerRow({ stage: "balance" })]);

    const result = await recordOfflinePayment(base);

    expect(mockMarkPaid).not.toHaveBeenCalled();
    expect(result.stageOutstanding).toBe(250);
  });

  it("does not re-mark a stage the invoice already shows as paid", async () => {
    mockInvoice.mockResolvedValue(
      invoice({
        deposits: [
          {
            stage: "first_deposit",
            label: "First deposit",
            amount: 250,
            paid: true,
          },
        ],
      }),
    );
    mockList.mockResolvedValue([ledgerRow()]);

    const result = await recordOfflinePayment(base);

    expect(mockMarkPaid).not.toHaveBeenCalled();
    expect(result.stageMarkedPaid).toBe(false);
  });

  it("keeps the payment when the Notion write fails", async () => {
    // The money is recorded either way; the checkbox is the atelier's own view
    // of it, so a Notion hiccup must not read as a lost payment.
    mockList.mockResolvedValue([ledgerRow()]);
    mockMarkPaid.mockRejectedValue(new Error("Notion down"));

    const result = await recordOfflinePayment(base);

    expect(result.written).toBe(true);
    expect(result.stageMarkedPaid).toBe(false);
  });

  it("names the stage as the ORDER calls it, not as the field is spelled", async () => {
    const result = await recordOfflinePayment(base);
    expect(result.stageLabel).toBe("First deposit");
  });
});

describe("an order with no invoice yet", () => {
  it("records the payment, keeping the stage, and settles nothing", async () => {
    mockInvoice.mockResolvedValue(null);

    const result = await recordOfflinePayment(base);

    expect(mockWrite).toHaveBeenCalledWith(
      expect.objectContaining({ stage: "first_deposit" }),
    );
    expect(mockMarkPaid).not.toHaveBeenCalled();
    expect(result.stageMarkedPaid).toBe(false);
  });
});

describe("shop orders", () => {
  const shopBase = {
    orderNumber: "SHP-000042",
    amount: 88,
    method: "cash" as const,
    paidOn: "2026-08-14",
  };

  beforeEach(() => {
    mockShop.mockResolvedValue({ orderNumber: "SHP-000042" } as never);
  });

  it("records against the order with no stage and no checkbox to settle", async () => {
    const result = await recordOfflinePayment(shopBase);

    expect(mockWrite).toHaveBeenCalledWith(
      expect.objectContaining({ orderKind: "shop", amountCents: 8800 }),
    );
    expect(mockWrite.mock.calls[0]?.[0]).not.toHaveProperty("stage");
    expect(result.stageMarkedPaid).toBe(false);
    expect(mockInvoice).not.toHaveBeenCalled();
  });

  it("404s a shop number nobody holds", async () => {
    mockShop.mockResolvedValue(null);
    await expect(recordOfflinePayment(shopBase)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("the history read back", () => {
  it("reports every payment now on the order", async () => {
    mockList.mockResolvedValue([
      ledgerRow({ amountCents: 25000, method: "cash" }),
    ]);

    const result = await recordOfflinePayment(base);

    expect(result.history).toEqual([
      "2026-08-14 · $250.00 paid · cash · first deposit",
    ]);
  });

  it("renders a refund row as money going out", async () => {
    mockList.mockResolvedValue([
      ledgerRow({ kind: "refund", amountCents: -4000, method: "stripe" }),
    ]);

    const result = await recordOfflinePayment(base);

    expect(result.history[0]).toContain("$40.00 refunded");
  });

  it("still reports the payment when the ledger can't be read back", async () => {
    // This read happens AFTER the row is written, both to settle the stage and
    // to show the history. Throwing would report a recorded payment as a
    // failure and invite the atelier to record it a second time.
    mockList.mockRejectedValue(new Error("db unreachable"));

    const result = await recordOfflinePayment(base);

    expect(result.written).toBe(true);
    expect(result.history).toEqual([]);
    // "Can't tell" is not "settled", and not "nothing outstanding" either.
    expect(result.stageMarkedPaid).toBe(false);
    expect(result.stageOutstanding).toBeUndefined();
  });
});
