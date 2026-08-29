// Issuing an invoice — freezing its charges into a numbered, dated document.
//
// What matters here is the line between what is frozen and what stays live, and
// the order of the two writes: the snapshot exists before the gate is ticked, so
// a failure part-way through can never publish an invoice with no document
// behind it.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/lib/notion/orders.repository.js", () => ({
  findOrderByNumber: vi.fn(),
  findOrderForStageNotification: vi.fn(),
}));
vi.mock("../../src/lib/resend/send.js", () => ({
  sendEmailBestEffort: vi.fn(),
}));
vi.mock("../../src/lib/notion/invoice.repository.js", () => ({
  findInvoice: vi.fn(),
  listInvoiceLineItems: vi.fn(),
  setInvoiceReady: vi.fn(),
}));
vi.mock("../../src/lib/db/issued-invoices.repository.js", () => ({
  issueInvoice: vi.fn(),
  findIssuedInvoice: vi.fn(),
}));

import {
  issueOrderInvoice,
  readIssuedInvoice,
  chargedLinesOf,
  issuedIdentity,
} from "../../src/services/invoice-issue.service.js";
import { BadRequestError, NotFoundError } from "../../src/lib/errors.js";
import {
  findOrderByNumber,
  findOrderForStageNotification,
} from "../../src/lib/notion/orders.repository.js";
import { sendEmailBestEffort } from "../../src/lib/resend/send.js";
import {
  findInvoice,
  listInvoiceLineItems,
  setInvoiceReady,
} from "../../src/lib/notion/invoice.repository.js";
import {
  issueInvoice,
  findIssuedInvoice,
} from "../../src/lib/db/issued-invoices.repository.js";
import type { OrderRecord } from "../../src/lib/notion/orders.schema.js";
import type { InvoiceRecord } from "../../src/lib/notion/invoice.schema.js";
import type { IssuedInvoice } from "../../src/lib/db/issued-invoices.repository.js";

const mockOrder = vi.mocked(findOrderByNumber);
const mockNotify = vi.mocked(findOrderForStageNotification);
const mockSend = vi.mocked(sendEmailBestEffort);
const mockInvoice = vi.mocked(findInvoice);
const mockLines = vi.mocked(listInvoiceLineItems);
const mockReady = vi.mocked(setInvoiceReady);
const mockIssue = vi.mocked(issueInvoice);
const mockFindIssued = vi.mocked(findIssuedInvoice);

const ISSUED: IssuedInvoice = {
  invoiceNumber: "INV-000007",
  invoicePageId: "inv-1",
  orderNumber: "ORD-000002",
  issuedAt: new Date("2026-08-14T15:04:05.000Z"),
  issuedBy: "alexandra@example.com",
  currency: "usd",
  subtotalCents: 75000,
  taxed: true,
  lines: [{ name: "Main fabric", type: "Material", amountCents: 75000 }],
  deposits: [],
};

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
    ready: false,
    balancePaid: false,
    deposits: [],
    ...overrides,
  } as InvoiceRecord;
}

beforeEach(() => {
  process.env.POSTGRES_URL = "postgres://localhost/test";
  mockOrder.mockResolvedValue(order());
  mockInvoice.mockResolvedValue(invoice());
  mockLines.mockResolvedValue([
    { name: "Main fabric", type: "Material", amount: 500 },
    { name: "Design & finishing", type: "Adjustment", amount: 250 },
  ]);
  mockIssue.mockResolvedValue({ issued: ISSUED, alreadyIssued: false });
  mockNotify.mockResolvedValue({
    orderNumber: "ORD-000002",
    orderName: "Ada – Custom Costume",
    email: "ada@example.com",
  } as never);
});

afterEach(() => {
  delete process.env.POSTGRES_URL;
});

describe("issueOrderInvoice", () => {
  it("snapshots the charged lines as cents, then ticks the gate", async () => {
    const result = await issueOrderInvoice({ orderNumber: "ORD-000002" });

    expect(mockIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        invoicePageId: "inv-1",
        orderNumber: "ORD-000002",
        subtotalCents: 75000,
        taxed: true,
        lines: [
          { name: "Main fabric", type: "Material", amountCents: 50000 },
          {
            name: "Design & finishing",
            type: "Adjustment",
            amountCents: 25000,
          },
        ],
      }),
    );
    expect(mockReady).toHaveBeenCalledWith("inv-1", true);
    expect(result.invoiceNumber).toBe("INV-000007");
    expect(result.markedReady).toBe(true);
  });

  it("writes the snapshot BEFORE the gate", async () => {
    // A gate ticked with no document behind it publishes exactly the mutable
    // invoice this replaces.
    const calls: string[] = [];
    mockIssue.mockImplementation(async () => {
      calls.push("issue");
      return { issued: ISSUED, alreadyIssued: false };
    });
    mockReady.mockImplementation(async () => {
      calls.push("ready");
    });

    await issueOrderInvoice({ orderNumber: "ORD-000002" });

    expect(calls).toEqual(["issue", "ready"]);
  });

  it("excludes a Deposit line from the snapshot", async () => {
    mockLines.mockResolvedValue([
      { name: "Main fabric", type: "Material", amount: 500 },
      { name: "Deposit", type: "Deposit", amount: 250 },
    ]);

    await issueOrderInvoice({ orderNumber: "ORD-000002" });

    const written = mockIssue.mock.calls[0]?.[0];
    expect(written?.lines).toHaveLength(1);
    expect(written?.subtotalCents).toBe(50000);
  });

  it("reports a re-press as a no-op and does not re-tick a set gate", async () => {
    mockIssue.mockResolvedValue({ issued: ISSUED, alreadyIssued: true });
    mockInvoice.mockResolvedValue(invoice({ ready: true }));

    const result = await issueOrderInvoice({ orderNumber: "ORD-000002" });

    expect(result.alreadyIssued).toBe(true);
    expect(result.invoiceNumber).toBe("INV-000007");
    expect(mockReady).not.toHaveBeenCalled();
  });

  it("keeps the issued document when the gate write fails", async () => {
    // The document is immutable and already written; the gate is a checkbox the
    // atelier can tick by hand. Throwing would read as a failed issue and invite
    // a re-press that could only find it already issued.
    mockReady.mockRejectedValue(new Error("Notion down"));

    const result = await issueOrderInvoice({ orderNumber: "ORD-000002" });

    expect(result.invoiceNumber).toBe("INV-000007");
    expect(result.markedReady).toBe(false);
  });

  it("refuses an invoice with no lines — that is not a document", async () => {
    mockLines.mockResolvedValue([]);

    await expect(
      issueOrderInvoice({ orderNumber: "ORD-000002" }),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(mockIssue).not.toHaveBeenCalled();
  });

  it("refuses to run without a database rather than ticking the gate anyway", async () => {
    delete process.env.POSTGRES_URL;

    await expect(
      issueOrderInvoice({ orderNumber: "ORD-000002" }),
    ).rejects.toThrow(/needs the database/);
    expect(mockReady).not.toHaveBeenCalled();
  });

  it("404s an unknown order and 400s an order with no invoice", async () => {
    mockOrder.mockResolvedValue(null);
    await expect(
      issueOrderInvoice({ orderNumber: "ORD-000002" }),
    ).rejects.toBeInstanceOf(NotFoundError);

    mockOrder.mockResolvedValue({
      ...order(),
      invoicePageId: undefined,
    } as OrderRecord);
    await expect(
      issueOrderInvoice({ orderNumber: "ORD-000002" }),
    ).rejects.toBeInstanceOf(BadRequestError);
  });
});

describe("readIssuedInvoice", () => {
  it("is null with no database, so readers fall back to the live rows", async () => {
    delete process.env.POSTGRES_URL;
    expect(await readIssuedInvoice("inv-1")).toBeNull();
    expect(mockFindIssued).not.toHaveBeenCalled();
  });

  it("degrades to null rather than throwing on a database failure", async () => {
    // A customer must be able to see and pay their invoice during an outage.
    mockFindIssued.mockRejectedValue(new Error("connection refused"));
    expect(await readIssuedInvoice("inv-1")).toBeNull();
  });
});

describe("chargedLinesOf", () => {
  const live = [
    { name: "Edited fabric", type: "Material", amount: 900 },
    { name: "A deposit", type: "Deposit", amount: 100 },
  ];

  it("prefers the ISSUED lines, so an edit in Notion can't change them", async () => {
    expect(chargedLinesOf(ISSUED, live)).toEqual([
      { name: "Main fabric", type: "Material", amount: 750 },
    ]);
  });

  it("falls back to the live rows, minus deposits, when never issued", () => {
    expect(chargedLinesOf(null, live)).toEqual([
      { name: "Edited fabric", type: "Material", amount: 900 },
    ]);
  });
});

describe("issuedIdentity", () => {
  it("carries the number and date as ISO", () => {
    expect(issuedIdentity(ISSUED)).toEqual({
      invoiceNumber: "INV-000007",
      issuedAt: "2026-08-14T15:04:05.000Z",
    });
  });

  it("is null for an invoice never issued", () => {
    expect(issuedIdentity(null)).toBeNull();
  });
});

describe("sending the customer their invoice", () => {
  it("emails it, with the number, the lines and the balance", async () => {
    const result = await issueOrderInvoice({ orderNumber: "ORD-000002" });

    expect(result.emailed).toBe(true);
    const message = mockSend.mock.calls[0]?.[0];
    expect(message?.to).toBe("ada@example.com");
    expect(message?.subject).toMatch(/INV-000007/);
    expect(message?.text).toMatch(/Main fabric/);
    expect(message?.text).toMatch(/Balance due: \$750\.00/);
  });

  it("credits a deposit already paid against the balance", async () => {
    // Deposits are credited LIVE, exactly as the invoice page credits them.
    // Credit notes can't exist yet — crediting requires an issued invoice, and
    // this one has only just become one.
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

    await issueOrderInvoice({ orderNumber: "ORD-000002" });

    expect(mockSend.mock.calls[0]?.[0].text).toMatch(/Balance due: \$500\.00/);
  });

  it("does NOT email on a re-press — a second copy reads as a chase", async () => {
    mockIssue.mockResolvedValue({ issued: ISSUED, alreadyIssued: true });

    const result = await issueOrderInvoice({ orderNumber: "ORD-000002" });

    expect(result.emailed).toBe(false);
    expect(result.emailSkipped).toMatch(/already issued/);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("says so for a legacy order with no email, and still issues", async () => {
    mockNotify.mockResolvedValue({
      orderNumber: "ORD-000002",
      orderName: "Ada – Custom Costume",
      email: "",
    } as never);

    const result = await issueOrderInvoice({ orderNumber: "ORD-000002" });

    expect(result.invoiceNumber).toBe("INV-000007");
    expect(result.emailed).toBe(false);
    expect(result.emailSkipped).toMatch(/no email address/);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("still sends when PUBLIC_BASE_URL is unset, just without the link", async () => {
    // `siteBaseUrl()` throws when it's unset, which would have taken the whole
    // send down over a missing link. Every other customer email omits its CTA
    // the same way.
    delete process.env.PUBLIC_BASE_URL;

    const result = await issueOrderInvoice({ orderNumber: "ORD-000002" });

    expect(result.emailed).toBe(true);
    expect(mockSend.mock.calls[0]?.[0].text).not.toMatch(/View your invoice:/);
  });

  it("includes the invoice link when the site origin is configured", async () => {
    process.env.PUBLIC_BASE_URL = "https://a3iceanddance.com/";

    await issueOrderInvoice({ orderNumber: "ORD-000002" });

    expect(mockSend.mock.calls[0]?.[0].text).toMatch(
      "https://a3iceanddance.com/invoice/ORD-000002",
    );
    delete process.env.PUBLIC_BASE_URL;
  });

  it("keeps the issued document when the send throws", async () => {
    // This runs after an immutable document has been written, so a Resend
    // hiccup must not read as a failed issue.
    mockSend.mockRejectedValue(new Error("Resend down"));

    const result = await issueOrderInvoice({ orderNumber: "ORD-000002" });

    expect(result.invoiceNumber).toBe("INV-000007");
    expect(result.emailed).toBe(false);
    expect(result.emailSkipped).toMatch(/could not be sent/);
  });
});
