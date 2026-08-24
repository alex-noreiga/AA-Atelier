import { describe, it, expect } from "vitest";
import { invoicePage, lineItemPage } from "../support/fake-notion.js";
import {
  extractInvoice,
  extractLineItem,
  extractPaymentReminderInvoice,
  extractInvoiceAnalytics,
  type NotionInvoicePage,
  type NotionLineItemPage,
} from "../../src/lib/notion/invoice.schema.js";

describe("extractInvoice", () => {
  it("reads the id, gate, paid flag, rollup balance, and deadline", () => {
    const page = invoicePage({
      id: "inv-1",
      invoiceId: "Toothless",
      ready: true,
      balancePaid: false,
      finalBalance: 420,
      paymentDeadline: "2026-09-01",
    }) as NotionInvoicePage;

    expect(extractInvoice(page)).toEqual({
      pageId: "inv-1",
      invoiceId: "Toothless",
      ready: true,
      balancePaid: false,
      finalBalance: 420,
      paymentDeadline: "2026-09-01",
      deposits: [],
    });
  });

  it("omits finalBalance/paymentDeadline when unset", () => {
    const page = invoicePage({
      id: "inv-2",
      invoiceId: "Draft",
      finalBalance: null,
      paymentDeadline: null,
    }) as NotionInvoicePage;

    expect(extractInvoice(page)).toEqual({
      pageId: "inv-2",
      invoiceId: "Draft",
      ready: false,
      balancePaid: false,
      deposits: [],
    });
  });

  it("reads the balance session id only when the balance was paid through one", () => {
    const paid = invoicePage({
      id: "inv-4",
      balancePaid: true,
      balanceSessionId: "cs_bal",
    }) as NotionInvoicePage;
    expect(extractInvoice(paid).balanceSessionId).toBe("cs_bal");

    // No session id recorded ⇒ the field is omitted (undefined).
    const noSession = invoicePage({ id: "inv-5" }) as NotionInvoicePage;
    expect(extractInvoice(noSession)).not.toHaveProperty("balanceSessionId");
  });

  it("maps staged deposits with an amount set, skipping unset ones", () => {
    const page = invoicePage({
      id: "inv-3",
      secondDepositAmount: 75,
      secondDepositPaid: true,
      secondDepositSessionId: "cs_d2",
    }) as NotionInvoicePage;

    // First deposit has no amount → skipped; second is surfaced.
    expect(extractInvoice(page).deposits).toEqual([
      {
        stage: "second_deposit",
        label: "Second deposit",
        amount: 75,
        paid: true,
        sessionId: "cs_d2",
      },
    ]);
  });
});

describe("extractLineItem", () => {
  it("reads the name, type, and formula Line Total", () => {
    const page = lineItemPage({
      name: "Main fabric",
      type: "Material",
      total: 55.5,
    }) as NotionLineItemPage;

    expect(extractLineItem(page)).toEqual({
      name: "Main fabric",
      type: "Material",
      amount: 55.5,
    });
  });

  it("treats a line whose Line Total isn't a number as $0", () => {
    const page = lineItemPage({
      name: "Placeholder",
      type: "Garment",
      total: null,
    }) as NotionLineItemPage;

    expect(extractLineItem(page).amount).toBe(0);
  });
});

describe("extractPaymentReminderInvoice", () => {
  it("surfaces only stages that have a due date, with paid/reminded flags", () => {
    const page = invoicePage({
      id: "inv-1",
      invoiceId: "Toothless",
      orderPageId: "order-1",
      firstDepositAmount: 100,
      firstDepositPaid: true,
      firstDepositDue: "2026-08-01",
      firstDepositReminded: true,
      secondDepositAmount: 80,
      secondDepositPaid: false,
      secondDepositDue: "2026-08-10",
      // Balance has no Payment Deadline set → not surfaced.
    }) as NotionInvoicePage;

    const view = extractPaymentReminderInvoice(page);
    expect(view.pageId).toBe("inv-1");
    expect(view.invoiceId).toBe("Toothless");
    expect(view.orderPageId).toBe("order-1");
    expect(view.depositCount).toBe(2);
    expect(view.stages).toEqual([
      {
        stage: "first_deposit",
        label: "First deposit",
        dueDate: "2026-08-01",
        paid: true,
        reminded: true,
        amount: 100,
      },
      {
        stage: "second_deposit",
        label: "Second deposit",
        dueDate: "2026-08-10",
        paid: false,
        reminded: false,
        amount: 80,
      },
    ]);
  });

  it("computes the balance amount as Final Balance minus paid deposits", () => {
    const page = invoicePage({
      id: "inv-2",
      finalBalance: 500,
      firstDepositAmount: 100,
      firstDepositPaid: true,
      secondDepositAmount: 80,
      secondDepositPaid: false, // unpaid → not credited
      paymentDeadline: "2026-09-01",
    }) as NotionInvoicePage;

    const balance = extractPaymentReminderInvoice(page).stages.find(
      (s) => s.stage === "balance",
    );
    expect(balance).toMatchObject({
      stage: "balance",
      label: "Final balance",
      dueDate: "2026-09-01",
      paid: false,
      amount: 400, // 500 - 100 (only the paid first deposit is credited)
    });
  });

  it("omits the balance amount when Final Balance isn't set, and omits an absent order relation", () => {
    const page = invoicePage({
      id: "inv-3",
      finalBalance: null,
      paymentDeadline: "2026-09-01",
    }) as NotionInvoicePage;

    const view = extractPaymentReminderInvoice(page);
    expect(view.orderPageId).toBeUndefined();
    const balance = view.stages.find((s) => s.stage === "balance");
    expect(balance).toMatchObject({ stage: "balance", dueDate: "2026-09-01" });
    expect(balance?.amount).toBeUndefined();
  });
});

describe("extractInvoiceAnalytics", () => {
  it("splits deposits into paid and still-owed, and keeps the order link", () => {
    const page = invoicePage({
      id: "inv-1",
      orderPageId: "order-1",
      finalBalance: 1000,
      firstDepositAmount: 200,
      firstDepositPaid: true,
      secondDepositAmount: 300,
      secondDepositPaid: false,
    }) as NotionInvoicePage;

    expect(extractInvoiceAnalytics(page)).toEqual({
      pageId: "inv-1",
      orderPageId: "order-1",
      finalBalance: 1000,
      depositsPaid: 200,
      depositsUnpaid: 300,
      balancePaid: false,
    });
  });

  it("omits the balance and order link when the invoice carries neither", () => {
    const page = invoicePage({ id: "inv-2" }) as NotionInvoicePage;
    expect(extractInvoiceAnalytics(page)).toEqual({
      pageId: "inv-2",
      depositsPaid: 0,
      depositsUnpaid: 0,
      balancePaid: false,
    });
  });

  it("ignores a deposit with no amount set", () => {
    const page = invoicePage({
      firstDepositAmount: null,
      firstDepositPaid: true,
      secondDepositAmount: 0,
    }) as NotionInvoicePage;

    const record = extractInvoiceAnalytics(page);
    expect(record.depositsPaid).toBe(0);
    expect(record.depositsUnpaid).toBe(0);
  });

  it("reads the balance-paid checkbox", () => {
    const page = invoicePage({
      balancePaid: true,
      finalBalance: 500,
    }) as NotionInvoicePage;
    expect(extractInvoiceAnalytics(page).balancePaid).toBe(true);
  });
});

// `depositCount` is counted from the AMOUNTS, not from `stages` — a deposit the
// atelier priced but gave no due date is still a deposit, and it is what decides
// whether the reminder email calls a lone one "Deposit" rather than "First
// deposit" (`services/payment-labels.ts`).
describe("extractPaymentReminderInvoice — depositCount", () => {
  it("counts a priced deposit that carries no due date", () => {
    const page = invoicePage({
      id: "inv-1",
      firstDepositAmount: 100,
      firstDepositDue: "2026-08-01",
      secondDepositAmount: 80, // priced, but never given a due date
    }) as NotionInvoicePage;

    const view = extractPaymentReminderInvoice(page);
    expect(view.stages).toHaveLength(1);
    expect(view.depositCount).toBe(2);
  });

  it("counts one when only a single deposit is priced", () => {
    const page = invoicePage({
      id: "inv-1",
      firstDepositAmount: 100,
      firstDepositDue: "2026-08-01",
    }) as NotionInvoicePage;
    expect(extractPaymentReminderInvoice(page).depositCount).toBe(1);
  });

  it("counts none on an invoice with no deposits set", () => {
    const page = invoicePage({ id: "inv-1" }) as NotionInvoicePage;
    expect(extractPaymentReminderInvoice(page).depositCount).toBe(0);
  });
});
