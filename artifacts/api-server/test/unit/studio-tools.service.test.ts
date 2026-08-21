// The studio tools dispatcher. The underlying services are mocked — each has its
// own suite — so what's under test here is the layer this file adds: which tool
// gets called with what, and how its result is classified and worded.
//
// The `ok` / `noop` / `attention` split is the part worth pinning down. Every
// tool is idempotent, so "ran and did nothing" is a normal outcome that must not
// read as success, and a refund the payment processor rejected must not read as
// either — it leaves work for a human and a re-run is the fix.

import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/services/schedule.service.js", () => ({
  reconcileMilestones: vi.fn(),
}));
vi.mock("../../src/services/invoice-generator.service.js", () => ({
  generateInvoiceLineItems: vi.fn(),
}));
vi.mock("../../src/services/order-notification.service.js", () => ({
  notifyOrderStageChange: vi.fn(),
}));
vi.mock("../../src/services/order-cancellation.service.js", () => ({
  processCancellation: vi.fn(),
}));
vi.mock("../../src/services/restock-notification.service.js", () => ({
  notifyRestock: vi.fn(),
}));
vi.mock("../../src/services/return-refund.service.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/services/return-refund.service.js")
  >("../../src/services/return-refund.service.js");
  // parseRefundTarget is a pure parser this layer reuses — keep the real one so
  // the dollars→cents conversion is exercised rather than asserted twice.
  return { ...actual, processReturnRefund: vi.fn() };
});

import { runStudioTool } from "../../src/services/studio-tools.service.js";
import { reconcileMilestones } from "../../src/services/schedule.service.js";
import { generateInvoiceLineItems } from "../../src/services/invoice-generator.service.js";
import { notifyOrderStageChange } from "../../src/services/order-notification.service.js";
import { processCancellation } from "../../src/services/order-cancellation.service.js";
import { processReturnRefund } from "../../src/services/return-refund.service.js";
import { notifyRestock } from "../../src/services/restock-notification.service.js";
import { BadRequestError, NotFoundError } from "../../src/lib/errors.js";

const mockMilestones = vi.mocked(reconcileMilestones);
const mockInvoiceLines = vi.mocked(generateInvoiceLineItems);
const mockNotify = vi.mocked(notifyOrderStageChange);
const mockCancel = vi.mocked(processCancellation);
const mockReturn = vi.mocked(processReturnRefund);
const mockRestock = vi.mocked(notifyRestock);

describe("runStudioTool — milestones", () => {
  it("reports what the reconciliation did, including the reminder passes", async () => {
    mockMilestones.mockResolvedValue({
      ordersProcessed: 3,
      milestonesCreated: 12,
      remindersSent: 1,
      paymentRemindersSent: 2,
      restockAlertsSent: 0,
      appointmentRemindersSent: 0,
      materialsDigestItems: 0,
    });

    const result = await runStudioTool("milestones");

    expect(result.status).toBe("ok");
    expect(result.message).toContain("12 milestones");
    expect(result.message).toContain("3 orders");
    expect(result.details).toEqual([
      "Sent 1 fitting reminder.",
      "Sent 2 payment reminders.",
    ]);
  });

  // The reconciliation also sweeps back-in-stock alerts, so a run that did
  // nothing but send those must still read as "ok", not "nothing to reconcile".
  it("counts the back-in-stock sweep as work done", async () => {
    mockMilestones.mockResolvedValue({
      ordersProcessed: 0,
      milestonesCreated: 0,
      remindersSent: 0,
      paymentRemindersSent: 0,
      restockAlertsSent: 4,
      appointmentRemindersSent: 0,
      materialsDigestItems: 0,
    });

    const result = await runStudioTool("milestones");

    expect(result.status).toBe("ok");
    expect(result.details).toEqual(["Sent 4 back-in-stock alerts."]);
  });

  // Same reasoning for the appointment reminders: the nightly run also sends
  // those, so a night whose only work was reminders is still work done.
  it("counts the appointment reminders as work done", async () => {
    mockMilestones.mockResolvedValue({
      ordersProcessed: 0,
      milestonesCreated: 0,
      remindersSent: 0,
      paymentRemindersSent: 0,
      restockAlertsSent: 0,
      appointmentRemindersSent: 2,
      materialsDigestItems: 0,
    });

    const result = await runStudioTool("milestones");

    expect(result.status).toBe("ok");
    expect(result.details).toEqual(["Sent 2 appointment reminders."]);
  });

  it("is a noop when there was nothing to generate and nothing to send", async () => {
    mockMilestones.mockResolvedValue({
      ordersProcessed: 0,
      milestonesCreated: 0,
      remindersSent: 0,
      paymentRemindersSent: 0,
      restockAlertsSent: 0,
      appointmentRemindersSent: 0,
      materialsDigestItems: 0,
    });

    const result = await runStudioTool("milestones");

    expect(result.status).toBe("noop");
    expect(result.details).toEqual([]);
  });

  it("is still ok when it only sent reminders", async () => {
    mockMilestones.mockResolvedValue({
      ordersProcessed: 0,
      milestonesCreated: 0,
      remindersSent: 2,
      paymentRemindersSent: 0,
      restockAlertsSent: 0,
      appointmentRemindersSent: 0,
      materialsDigestItems: 0,
    });

    const result = await runStudioTool("milestones");

    expect(result.status).toBe("ok");
  });
});

describe("runStudioTool — invoice-lines", () => {
  it("lists the lines it wrote and the invoice total", async () => {
    mockInvoiceLines.mockResolvedValue({
      orderNumber: "ORD-000002",
      alreadyPresent: false,
      materialLinesCreated: 3,
      laborLineCreated: true,
      adjustmentLineCreated: true,
      rushSurcharge: 0,
      invoiceTotal: 812.5,
    });

    const result = await runStudioTool("invoice-lines", {
      orderNumber: "ORD-000002",
    });

    expect(mockInvoiceLines).toHaveBeenCalledWith("ORD-000002");
    expect(result.status).toBe("ok");
    expect(result.message).toContain(
      "3 material lines, a labor line and a design & finishing line",
    );
    expect(result.message).toContain("$812.50");
  });

  it("names the rush surcharge when one was priced in", async () => {
    mockInvoiceLines.mockResolvedValue({
      orderNumber: "ORD-000002",
      alreadyPresent: false,
      materialLinesCreated: 1,
      laborLineCreated: true,
      adjustmentLineCreated: false,
      rushSurcharge: 75,
      invoiceTotal: 575,
    });

    const result = await runStudioTool("invoice-lines", {
      orderNumber: "ORD-000002",
    });

    expect(result.message).toContain("a rush surcharge of $75.00");
  });

  it("is a noop on an invoice that already has lines, and says how to rebuild", async () => {
    mockInvoiceLines.mockResolvedValue({
      orderNumber: "ORD-000002",
      alreadyPresent: true,
      materialLinesCreated: 0,
      laborLineCreated: false,
      adjustmentLineCreated: false,
      rushSurcharge: 0,
      invoiceTotal: 0,
    });

    const result = await runStudioTool("invoice-lines", {
      orderNumber: "ORD-000002",
    });

    expect(result.status).toBe("noop");
    expect(result.details.join(" ")).toContain("delete the existing lines");
  });

  it("rejects a run with no order number before calling the service", async () => {
    await expect(runStudioTool("invoice-lines", {})).rejects.toBeInstanceOf(
      BadRequestError,
    );
    expect(mockInvoiceLines).not.toHaveBeenCalled();
  });

  it("trims the pasted order number", async () => {
    mockInvoiceLines.mockResolvedValue({
      orderNumber: "ORD-000002",
      alreadyPresent: true,
      materialLinesCreated: 0,
      laborLineCreated: false,
      adjustmentLineCreated: false,
      rushSurcharge: 0,
      invoiceTotal: 0,
    });

    await runStudioTool("invoice-lines", { orderNumber: "  ORD-000002 " });

    expect(mockInvoiceLines).toHaveBeenCalledWith("ORD-000002");
  });
});

describe("runStudioTool — status-email", () => {
  it("sends and names the stage the customer was told about", async () => {
    mockNotify.mockResolvedValue({
      orderNumber: "000002",
      status: "sent",
      currentStage: "Sketching",
    });

    const result = await runStudioTool("status-email", {
      orderNumber: "000002",
    });

    expect(mockNotify).toHaveBeenCalledWith(
      { orderNumber: "000002" },
      { force: false },
    );
    expect(result.status).toBe("ok");
    expect(result.message).toContain("Sketching");
  });

  it("passes force through for a deliberate resend", async () => {
    mockNotify.mockResolvedValue({
      orderNumber: "000002",
      status: "sent",
      currentStage: "Sketching",
    });

    await runStudioTool("status-email", { orderNumber: "000002", force: true });

    expect(mockNotify).toHaveBeenCalledWith(
      { orderNumber: "000002" },
      { force: true },
    );
  });

  it("turns the service's not_found into a 404-shaped error", async () => {
    mockNotify.mockResolvedValue({
      orderNumber: "ORD-NOPE",
      status: "not_found",
    });

    await expect(
      runStudioTool("status-email", { orderNumber: "ORD-NOPE" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("is a noop for a skipped send, surfacing the reason", async () => {
    mockNotify.mockResolvedValue({
      orderNumber: "000002",
      status: "skipped",
      reason: "no email on order",
    });

    const result = await runStudioTool("status-email", {
      orderNumber: "000002",
    });

    expect(result.status).toBe("noop");
    expect(result.details[0]).toBe("no email on order");
  });
});

describe("runStudioTool — cancellation-refund", () => {
  const base = {
    orderType: "custom" as const,
    orderNumber: "ORD-000002",
    refundsIssued: 0,
    totalRefunded: 0,
    alreadyCancelled: false,
    cancelledNow: false,
    hadError: false,
    skipped: [] as string[],
  };

  it("summarizes the refunds and the cancellation", async () => {
    mockCancel.mockResolvedValue({
      ...base,
      refundsIssued: 2,
      totalRefunded: 450,
      cancelledNow: true,
    });

    const result = await runStudioTool("cancellation-refund", {
      orderNumber: "ORD-000002",
    });

    expect(result.status).toBe("ok");
    expect(result.message).toContain("refunded 2 payments totalling $450.00");
    expect(result.message).toContain("the order is now marked cancelled");
  });

  it("flags a partial failure for attention and says a re-run is safe", async () => {
    mockCancel.mockResolvedValue({
      ...base,
      hadError: true,
      skipped: ["Balance: no such session in live mode"],
    });

    const result = await runStudioTool("cancellation-refund", {
      orderNumber: "ORD-000002",
    });

    expect(result.status).toBe("attention");
    expect(result.details).toContain("Balance: no such session in live mode");
    expect(result.details.join(" ")).toContain("run this again");
  });

  it("is a noop when the order was already cancelled and nothing was owed", async () => {
    mockCancel.mockResolvedValue({
      ...base,
      alreadyCancelled: true,
      skipped: ["First deposit: already refunded"],
    });

    const result = await runStudioTool("cancellation-refund", {
      orderNumber: "ORD-000002",
    });

    expect(result.status).toBe("noop");
    expect(result.message).toContain("no new refunds were needed");
    expect(result.details).toEqual(["First deposit: already refunded"]);
  });
});

describe("runStudioTool — return-refund", () => {
  const base = {
    orderNumber: "SHP-ABC123",
    refunded: 0,
    totalRefunded: 0,
    captured: 200,
    fullyRefunded: false,
    markerFailed: false,
    notes: [] as string[],
  };

  it("refunds in full when no amount is given", async () => {
    mockReturn.mockResolvedValue({
      ...base,
      status: "refunded",
      refunded: 200,
      totalRefunded: 200,
      fullyRefunded: true,
    });

    const result = await runStudioTool("return-refund", {
      orderNumber: "SHP-ABC123",
    });

    // undefined target ⇒ "refund it all", deliberately distinct from 0.
    expect(mockReturn).toHaveBeenCalledWith("SHP-ABC123", undefined);
    expect(result.status).toBe("ok");
    expect(result.message).toContain("the order is now fully refunded");
  });

  it("converts a dollar amount to the cents target the service takes", async () => {
    mockReturn.mockResolvedValue({
      ...base,
      status: "refunded",
      refunded: 45.5,
      totalRefunded: 45.5,
    });

    const result = await runStudioTool("return-refund", {
      orderNumber: "SHP-ABC123",
      amount: 45.5,
    });

    expect(mockReturn).toHaveBeenCalledWith("SHP-ABC123", 4550);
    expect(result.message).toContain("$154.50 of the original payment remains");
  });

  it("treats 0 as an even exchange, not as 'refund everything'", async () => {
    mockReturn.mockResolvedValue({ ...base, status: "already_at_target" });

    const result = await runStudioTool("return-refund", {
      orderNumber: "SHP-ABC123",
      amount: 0,
    });

    expect(mockReturn).toHaveBeenCalledWith("SHP-ABC123", 0);
    expect(result.status).toBe("noop");
  });

  it("flags a Stripe failure for attention", async () => {
    mockReturn.mockResolvedValue({
      ...base,
      status: "error",
      notes: ["Stripe refused the refund"],
    });

    const result = await runStudioTool("return-refund", {
      orderNumber: "SHP-ABC123",
    });

    expect(result.status).toBe("attention");
    expect(result.details).toContain("Stripe refused the refund");
  });

  it("rejects a run with no order number before calling Stripe", async () => {
    await expect(
      runStudioTool("return-refund", { amount: 10 }),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(mockReturn).not.toHaveBeenCalled();
  });
});

describe("runStudioTool — restock-alert", () => {
  const swept = {
    status: "sent" as const,
    notified: 3,
    unmatched: 0,
    alreadyAlerted: 0,
    items: [{ item: "Bow Fleece Soaker", notified: 3 }],
  };

  // Unlike every other tool this one takes no required argument: blank means
  // "every piece currently in stock", which is what the nightly run does.
  it("sweeps everything when no item is given", async () => {
    mockRestock.mockResolvedValue(swept);

    const result = await runStudioTool("restock-alert", {});

    expect(mockRestock).toHaveBeenCalledWith({});
    expect(result.status).toBe("ok");
  });

  it("scopes to one piece when named, trimming it", async () => {
    mockRestock.mockResolvedValue({ ...swept, item: "Bow Fleece Soaker" });

    await runStudioTool("restock-alert", { item: "  Bow Fleece Soaker  " });

    expect(mockRestock).toHaveBeenCalledWith({ item: "Bow Fleece Soaker" });
  });

  it("reports the totals and breaks them down per piece", async () => {
    mockRestock.mockResolvedValue({
      ...swept,
      notified: 4,
      items: [
        { item: "Bow Fleece Soaker", notified: 3 },
        { item: "Blade Towel", notified: 1 },
      ],
    });

    const result = await runStudioTool("restock-alert", {});

    expect(result.status).toBe("ok");
    expect(result.message).toContain("4 customers");
    expect(result.message).toContain("2 pieces");
    expect(result.details).toEqual([
      "Bow Fleece Soaker: 3 customers.",
      "Blade Towel: 1 customer.",
    ]);
  });

  it("says who was already told and who is still waiting on a size", async () => {
    mockRestock.mockResolvedValue({
      ...swept,
      notified: 1,
      unmatched: 2,
      alreadyAlerted: 5,
      items: [{ item: "Bow Fleece Soaker", notified: 1 }],
    });

    const result = await runStudioTool("restock-alert", {});

    expect(result.details).toEqual([
      "Bow Fleece Soaker: 1 customer.",
      "5 requests had already been answered.",
      "2 requests still waiting — they asked about a size that isn't back yet.",
    ]);
  });

  // The normal result of pressing it twice, and of a Status change that took a
  // piece out of stock — neither must read as success.
  it("is a noop with the reason when nothing was sent", async () => {
    mockRestock.mockResolvedValue({
      status: "skipped",
      notified: 0,
      unmatched: 0,
      alreadyAlerted: 2,
      items: [],
      reason: "everyone waiting has already been told",
    });

    const result = await runStudioTool("restock-alert", {});

    expect(result.status).toBe("noop");
    expect(result.details[0]).toBe("everyone waiting has already been told");
  });

  // Nothing will ever send until someone configures it, so it isn't a noop.
  it("asks for attention when there's nowhere to record who was told", async () => {
    mockRestock.mockResolvedValue({
      status: "unconfigured",
      notified: 0,
      unmatched: 0,
      alreadyAlerted: 0,
      items: [],
      reason: "POSTGRES_URL isn't configured, so there's nowhere to record.",
    });

    const result = await runStudioTool("restock-alert", {});

    expect(result.status).toBe("attention");
    expect(result.details.join(" ")).toMatch(/POSTGRES_URL/);
  });

  it("turns a name that matches no piece into a 404", async () => {
    mockRestock.mockResolvedValue({
      status: "not_found",
      notified: 0,
      unmatched: 0,
      alreadyAlerted: 0,
      items: [],
      item: "Nothing",
    });

    await expect(
      runStudioTool("restock-alert", { item: "Nothing" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
