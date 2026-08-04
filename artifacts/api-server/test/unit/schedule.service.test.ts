import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Notion repositories so the orchestration runs without network, and
// silence the logger so the per-order error path doesn't spam test output.
vi.mock("../../src/lib/notion/orders.repository.js", () => ({
  findOrdersNeedingMilestones: vi.fn(),
  findOrdersWithMilestones: vi.fn(),
  markMilestonesGenerated: vi.fn(),
  findOrderForStageNotificationByPageId: vi.fn(),
}));
vi.mock("../../src/lib/notion/production-schedule.repository.js", () => ({
  createMilestone: vi.fn(),
  orderHasMilestones: vi.fn(),
  listOrderMilestonePages: vi.fn(),
  updateMilestoneStatus: vi.fn(),
  findMilestonesNeedingFittingReminder: vi.fn(),
  markFittingReminderSent: vi.fn(),
}));
vi.mock("../../src/lib/notion/invoice.repository.js", () => ({
  findInvoicesNeedingPaymentReminder: vi.fn(),
  markPaymentStageReminded: vi.fn(),
}));
vi.mock("../../src/lib/resend/send.js", () => ({
  sendEmailBestEffort: vi.fn(),
}));
vi.mock("../../src/lib/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import {
  computeMilestoneSchedule,
  remainingStages,
  generatePendingMilestones,
  milestoneStatusFor,
  syncMilestoneStatuses,
  sendDueFittingReminders,
  sendDuePaymentReminders,
  reconcileMilestones,
} from "../../src/services/schedule.service.js";
import {
  findOrdersNeedingMilestones,
  findOrdersWithMilestones,
  markMilestonesGenerated,
  findOrderForStageNotificationByPageId,
  type PendingMilestoneOrder,
} from "../../src/lib/notion/orders.repository.js";
import {
  createMilestone,
  orderHasMilestones,
  listOrderMilestonePages,
  updateMilestoneStatus,
  findMilestonesNeedingFittingReminder,
  markFittingReminderSent,
} from "../../src/lib/notion/production-schedule.repository.js";
import {
  findInvoicesNeedingPaymentReminder,
  markPaymentStageReminded,
} from "../../src/lib/notion/invoice.repository.js";
import { sendEmailBestEffort } from "../../src/lib/resend/send.js";
import { logger } from "../../src/lib/logger.js";

const mockFind = vi.mocked(findOrdersNeedingMilestones);
const mockFindWith = vi.mocked(findOrdersWithMilestones);
const mockMark = vi.mocked(markMilestonesGenerated);
const mockFindOrderByPage = vi.mocked(findOrderForStageNotificationByPageId);
const mockCreate = vi.mocked(createMilestone);
const mockHas = vi.mocked(orderHasMilestones);
const mockListPages = vi.mocked(listOrderMilestonePages);
const mockUpdateStatus = vi.mocked(updateMilestoneStatus);
const mockFindReminders = vi.mocked(findMilestonesNeedingFittingReminder);
const mockMarkReminded = vi.mocked(markFittingReminderSent);
const mockFindPaymentInvoices = vi.mocked(findInvoicesNeedingPaymentReminder);
const mockMarkPaymentReminded = vi.mocked(markPaymentStageReminded);
const mockSend = vi.mocked(sendEmailBestEffort);

const from = new Date("2026-01-01T00:00:00Z");

describe("remainingStages", () => {
  const stages = ["Consultation", "Fitting", "Delivery"];

  it("returns the current stage and everything after it (inclusive)", () => {
    expect(remainingStages(stages, "Fitting")).toEqual(["Fitting", "Delivery"]);
  });

  it("returns just the last stage when that's the current one", () => {
    expect(remainingStages(stages, "Delivery")).toEqual(["Delivery"]);
  });

  it("falls back to the whole list when the current stage isn't found", () => {
    expect(remainingStages(stages, "Renamed")).toEqual(stages);
    expect(remainingStages(stages, "")).toEqual(stages);
  });
});

describe("computeMilestoneSchedule", () => {
  it("spreads stages evenly, landing the last one on the due date", () => {
    const dueDate = new Date("2026-01-11T00:00:00Z"); // 10 days out
    const schedule = computeMilestoneSchedule(
      dueDate,
      ["A", "B", "C", "D", "E"],
      from,
    );
    expect(schedule).toEqual([
      { stage: "A", targetDate: "2026-01-03" },
      { stage: "B", targetDate: "2026-01-05" },
      { stage: "C", targetDate: "2026-01-07" },
      { stage: "D", targetDate: "2026-01-09" },
      { stage: "E", targetDate: "2026-01-11" },
    ]);
  });

  it("puts a single remaining stage on the due date", () => {
    const dueDate = new Date("2026-03-20T00:00:00Z");
    expect(computeMilestoneSchedule(dueDate, ["Delivery"], from)).toEqual([
      { stage: "Delivery", targetDate: "2026-03-20" },
    ]);
  });

  it("clamps every milestone to the due date when it's today or past", () => {
    const past = new Date("2025-12-20T00:00:00Z"); // before `from`
    const schedule = computeMilestoneSchedule(past, ["A", "B"], from);
    expect(schedule).toEqual([
      { stage: "A", targetDate: "2025-12-20" },
      { stage: "B", targetDate: "2025-12-20" },
    ]);
  });

  it("returns [] for no stages", () => {
    expect(computeMilestoneSchedule(new Date(), [], from)).toEqual([]);
  });
});

describe("generatePendingMilestones", () => {
  beforeEach(() => {
    mockHas.mockResolvedValue(false);
    mockCreate.mockResolvedValue();
    mockMark.mockResolvedValue();
  });

  function order(
    overrides: Partial<PendingMilestoneOrder> = {},
  ): PendingMilestoneOrder {
    return {
      pageId: "page-1",
      orderNumber: "000002",
      orderName: "Ada – Custom Dress",
      currentStage: "Fitting",
      dueDate: "2026-01-11",
      stages: ["Consultation", "Fitting", "Delivery"],
      ...overrides,
    };
  }

  it("creates one milestone per remaining stage, derives the client name, then marks generated", async () => {
    mockFind.mockResolvedValue([order()]);

    const result = await generatePendingMilestones(from);

    // Remaining stages from "Fitting" forward → 2 milestones.
    expect(mockCreate).toHaveBeenCalledTimes(2);
    const stagesWritten = mockCreate.mock.calls.map((c) => c[0].stage);
    expect(stagesWritten).toEqual(["Fitting", "Delivery"]);
    // The milestone row carries only the lean set — the stage is folded into the
    // title; client name + due date are reachable via the Order relation.
    expect(mockCreate.mock.calls[0][0]).toMatchObject({
      orderPageId: "page-1",
      projectName: "Ada – Custom Dress — Fitting",
      stage: "Fitting",
    });
    expect(mockMark).toHaveBeenCalledWith("page-1");
    expect(result).toEqual({ ordersProcessed: 1, milestonesCreated: 2 });
  });

  it("skips creation but still marks generated when milestones already exist", async () => {
    mockFind.mockResolvedValue([order()]);
    mockHas.mockResolvedValue(true);

    const result = await generatePendingMilestones(from);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockMark).toHaveBeenCalledWith("page-1");
    expect(result).toEqual({ ordersProcessed: 1, milestonesCreated: 0 });
  });

  it("isolates a failing order: logs it, doesn't mark it, and still processes the rest", async () => {
    mockFind.mockResolvedValue([
      order({ pageId: "bad", orderNumber: "BAD" }),
      order({ pageId: "good", orderNumber: "GOOD" }),
    ]);
    mockCreate.mockImplementation(async (input) => {
      if (input.orderPageId === "bad") throw new Error("Notion 500");
    });

    const result = await generatePendingMilestones(from);

    // The bad order never gets its checkbox flipped (so the next run retries it).
    expect(mockMark).toHaveBeenCalledWith("good");
    expect(mockMark).not.toHaveBeenCalledWith("bad");
    expect(logger.error).toHaveBeenCalledTimes(1);
    // Only the good order counts as processed; it wrote its 2 milestones.
    expect(result).toEqual({ ordersProcessed: 1, milestonesCreated: 2 });
  });

  it("does nothing when no orders need milestones", async () => {
    mockFind.mockResolvedValue([]);
    const result = await generatePendingMilestones(from);
    expect(result).toEqual({ ordersProcessed: 0, milestonesCreated: 0 });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockMark).not.toHaveBeenCalled();
  });
});

describe("milestoneStatusFor", () => {
  const stages = ["Consultation", "Fitting", "Rhinestoning", "Delivered"];

  it("marks a stage the order has moved past as Completed", () => {
    expect(milestoneStatusFor(stages, "Rhinestoning", "Fitting")).toBe(
      "Completed",
    );
  });

  it("marks the stage the order is currently at as In Progress", () => {
    expect(milestoneStatusFor(stages, "Fitting", "Fitting")).toBe(
      "In Progress",
    );
  });

  it("marks a stage still ahead as Not Started", () => {
    expect(milestoneStatusFor(stages, "Fitting", "Delivered")).toBe(
      "Not Started",
    );
  });

  it("marks the final stage Completed once the order reaches it (delivered)", () => {
    expect(milestoneStatusFor(stages, "Delivered", "Delivered")).toBe(
      "Completed",
    );
  });

  it("falls back to Not Started when a stage isn't in the live list", () => {
    expect(milestoneStatusFor(stages, "Fitting", "Renamed")).toBe(
      "Not Started",
    );
    expect(milestoneStatusFor(stages, "Gone", "Fitting")).toBe("Not Started");
  });
});

describe("syncMilestoneStatuses", () => {
  function order(
    overrides: Partial<PendingMilestoneOrder> = {},
  ): PendingMilestoneOrder {
    return {
      pageId: "page-1",
      orderNumber: "000002",
      orderName: "Ada – Custom Dress",
      currentStage: "Fitting",
      dueDate: "2026-01-11",
      stages: ["Consultation", "Fitting", "Delivered"],
      ...overrides,
    };
  }

  beforeEach(() => {
    mockUpdateStatus.mockResolvedValue();
  });

  it("PATCHes only the milestones whose status drifted from the order's stage", async () => {
    mockFindWith.mockResolvedValue([order()]);
    mockListPages.mockResolvedValue([
      // Past stage still reads Not Started → should become Completed.
      { pageId: "m-consult", stage: "Consultation", status: "Not Started" },
      // Current stage already In Progress → no change.
      { pageId: "m-fitting", stage: "Fitting", status: "In Progress" },
      // Future stage already Not Started → no change.
      { pageId: "m-delivered", stage: "Delivered", status: "Not Started" },
    ]);

    const updated = await syncMilestoneStatuses();

    expect(mockUpdateStatus).toHaveBeenCalledTimes(1);
    expect(mockUpdateStatus).toHaveBeenCalledWith("m-consult", "Completed");
    expect(updated).toBe(1);
  });

  it("skips rows with no stage rather than blanking their status", async () => {
    mockFindWith.mockResolvedValue([order()]);
    mockListPages.mockResolvedValue([
      { pageId: "m-blank", stage: "", status: "In Progress" },
    ]);

    const updated = await syncMilestoneStatuses();

    expect(mockUpdateStatus).not.toHaveBeenCalled();
    expect(updated).toBe(0);
  });

  it("isolates a failing order: logs it and still processes the rest", async () => {
    mockFindWith.mockResolvedValue([
      order({ pageId: "bad", orderNumber: "BAD" }),
      order({ pageId: "good", orderNumber: "GOOD" }),
    ]);
    mockListPages.mockImplementation(async (orderPageId) => {
      if (orderPageId === "bad") throw new Error("Notion 500");
      return [{ pageId: "m-1", stage: "Consultation", status: "Not Started" }];
    });

    const updated = await syncMilestoneStatuses();

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(mockUpdateStatus).toHaveBeenCalledWith("m-1", "Completed");
    expect(updated).toBe(1);
  });

  it("does nothing when no orders have milestones", async () => {
    mockFindWith.mockResolvedValue([]);
    expect(await syncMilestoneStatuses()).toBe(0);
    expect(mockUpdateStatus).not.toHaveBeenCalled();
  });
});

describe("sendDueFittingReminders", () => {
  function milestone(overrides = {}) {
    return {
      pageId: "m-fitting",
      stage: "Fitting",
      targetDate: "2026-01-08",
      orderPageId: "order-1",
      ...overrides,
    };
  }

  // The service only reads `email` + `orderNumber` off the resolved order.
  function orderNotification(overrides = {}) {
    return {
      pageId: "order-1",
      orderNumber: "000002",
      orderName: "Ada – Custom Dress",
      email: "ada@example.com",
      currentStage: "Sewing/Construction",
      stages: ["Consultation", "Fitting", "Delivered"],
      lastNotifiedStage: "",
      ...overrides,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  beforeEach(() => {
    mockMarkReminded.mockResolvedValue();
    mockSend.mockResolvedValue();
    delete process.env.PUBLIC_BASE_URL;
  });

  it("emails the customer for a due fitting milestone and marks it reminded", async () => {
    process.env.PUBLIC_BASE_URL = "https://a3iceanddance.com/";
    mockFindReminders.mockResolvedValue([milestone()]);
    mockFindOrderByPage.mockResolvedValue(orderNotification());

    const sent = await sendDueFittingReminders(from);

    expect(sent).toBe(1);
    expect(mockFindOrderByPage).toHaveBeenCalledWith("order-1");
    expect(mockSend).toHaveBeenCalledTimes(1);
    const message = mockSend.mock.calls[0][0];
    expect(message.to).toBe("ada@example.com");
    // Booking deep link (trailing slash stripped) points at the fitting flow.
    expect(message.html).toContain(
      "https://a3iceanddance.com/appointments?type=fitting",
    );
    expect(mockMarkReminded).toHaveBeenCalledWith("m-fitting");
    delete process.env.PUBLIC_BASE_URL;
  });

  it("marks the milestone reminded without sending when the order has no email", async () => {
    mockFindReminders.mockResolvedValue([milestone()]);
    mockFindOrderByPage.mockResolvedValue(orderNotification({ email: "" }));

    const sent = await sendDueFittingReminders(from);

    expect(sent).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
    // Still marked, so an unreachable order isn't re-checked every night.
    expect(mockMarkReminded).toHaveBeenCalledWith("m-fitting");
  });

  it("skips (and does not mark) a milestone whose order lookup throws, and isolates it", async () => {
    mockFindReminders.mockResolvedValue([
      milestone({ pageId: "bad", orderPageId: "bad-order" }),
      milestone({ pageId: "good", orderPageId: "good-order" }),
    ]);
    mockFindOrderByPage.mockImplementation(async (pageId: string) => {
      if (pageId === "bad-order") throw new Error("Notion 500");
      return orderNotification({ pageId: "good-order" });
    });

    const sent = await sendDueFittingReminders(from);

    expect(sent).toBe(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(mockMarkReminded).toHaveBeenCalledWith("good");
    expect(mockMarkReminded).not.toHaveBeenCalledWith("bad");
  });

  it("returns 0 (and logs) when the reminder query itself fails", async () => {
    mockFindReminders.mockRejectedValue(new Error("Notion down"));

    const sent = await sendDueFittingReminders(from);

    expect(sent).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockMarkReminded).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it("does nothing when no fitting milestones are due", async () => {
    mockFindReminders.mockResolvedValue([]);
    expect(await sendDueFittingReminders(from)).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe("sendDuePaymentReminders", () => {
  function invoice(overrides = {}) {
    return {
      pageId: "inv-1",
      invoiceId: "Toothless",
      orderPageId: "order-1",
      stages: [
        {
          stage: "second_deposit" as const,
          label: "Second deposit",
          dueDate: "2026-01-05",
          paid: false,
          reminded: false,
          amount: 80,
        },
      ],
      ...overrides,
    };
  }

  function orderNotification(overrides = {}) {
    return {
      pageId: "order-1",
      orderNumber: "000002",
      orderName: "Ada – Custom Dress",
      email: "ada@example.com",
      currentStage: "Fitting",
      stages: ["Consultation", "Fitting", "Delivered"],
      lastNotifiedStage: "",
      ...overrides,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  beforeEach(() => {
    mockMarkPaymentReminded.mockResolvedValue();
    mockSend.mockResolvedValue();
    delete process.env.PUBLIC_BASE_URL;
  });

  it("emails an overdue stage and marks it reminded, with a pay link", async () => {
    process.env.PUBLIC_BASE_URL = "https://a3iceanddance.com/";
    mockFindPaymentInvoices.mockResolvedValue([invoice()]);
    mockFindOrderByPage.mockResolvedValue(orderNotification());

    // `from` is 2026-01-01; the stage is due 2026-01-05 → upcoming, not overdue.
    const sent = await sendDuePaymentReminders(
      new Date("2026-01-10T00:00:00Z"),
    );

    expect(sent).toBe(1);
    expect(mockFindOrderByPage).toHaveBeenCalledWith("order-1");
    const message = mockSend.mock.calls[0][0];
    expect(message.to).toBe("ada@example.com");
    expect(message.subject).toContain("Payment overdue");
    expect(message.html).toContain(
      "https://a3iceanddance.com/track?orderNumber=000002",
    );
    expect(mockMarkPaymentReminded).toHaveBeenCalledWith(
      "inv-1",
      "second_deposit",
    );
  });

  it("uses the coming-due wording when the due date is still ahead", async () => {
    mockFindPaymentInvoices.mockResolvedValue([invoice()]);
    mockFindOrderByPage.mockResolvedValue(orderNotification());

    await sendDuePaymentReminders(from); // 2026-01-01, before the 2026-01-05 due

    expect(mockSend.mock.calls[0][0].subject).toContain("Payment reminder");
  });

  it("marks a stage reminded without sending when the order has no email", async () => {
    mockFindPaymentInvoices.mockResolvedValue([invoice()]);
    mockFindOrderByPage.mockResolvedValue(orderNotification({ email: "" }));

    const sent = await sendDuePaymentReminders(from);

    expect(sent).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockMarkPaymentReminded).toHaveBeenCalledWith(
      "inv-1",
      "second_deposit",
    );
  });

  it("skips already-paid/reminded stages and invoices with no due stage", async () => {
    mockFindPaymentInvoices.mockResolvedValue([
      invoice({
        stages: [
          {
            stage: "first_deposit" as const,
            label: "First deposit",
            dueDate: "2026-01-05",
            paid: true, // already paid
            reminded: false,
            amount: 100,
          },
        ],
      }),
    ]);

    const sent = await sendDuePaymentReminders(from);

    expect(sent).toBe(0);
    expect(mockFindOrderByPage).not.toHaveBeenCalled();
    expect(mockMarkPaymentReminded).not.toHaveBeenCalled();
  });

  it("isolates an invoice whose order lookup throws (leaves it unmarked to retry)", async () => {
    mockFindPaymentInvoices.mockResolvedValue([
      invoice({ pageId: "bad", orderPageId: "bad-order" }),
      invoice({ pageId: "good", orderPageId: "good-order" }),
    ]);
    mockFindOrderByPage.mockImplementation(async (pageId: string) => {
      if (pageId === "bad-order") throw new Error("Notion 500");
      return orderNotification({ pageId: "good-order" });
    });

    const sent = await sendDuePaymentReminders(from);

    expect(sent).toBe(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(mockMarkPaymentReminded).toHaveBeenCalledWith(
      "good",
      "second_deposit",
    );
    expect(mockMarkPaymentReminded).not.toHaveBeenCalledWith(
      "bad",
      "second_deposit",
    );
  });

  it("returns 0 (and logs) when the invoice query itself fails", async () => {
    mockFindPaymentInvoices.mockRejectedValue(new Error("Notion down"));

    const sent = await sendDuePaymentReminders(from);

    expect(sent).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockMarkPaymentReminded).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it("does nothing when no invoices are due", async () => {
    mockFindPaymentInvoices.mockResolvedValue([]);
    expect(await sendDuePaymentReminders(from)).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe("reconcileMilestones", () => {
  beforeEach(() => {
    mockHas.mockResolvedValue(false);
    mockCreate.mockResolvedValue();
    mockMark.mockResolvedValue();
    mockUpdateStatus.mockResolvedValue();
    mockFindReminders.mockResolvedValue([]);
    mockMarkReminded.mockResolvedValue();
    mockFindPaymentInvoices.mockResolvedValue([]);
    mockMarkPaymentReminded.mockResolvedValue();
    mockSend.mockResolvedValue();
  });

  it("runs generation then the status sync and combines their counts", async () => {
    mockFind.mockResolvedValue([
      {
        pageId: "page-1",
        orderNumber: "000002",
        orderName: "Ada – Custom Dress",
        currentStage: "Fitting",
        dueDate: "2026-01-11",
        stages: ["Consultation", "Fitting", "Delivered"],
      },
    ]);
    mockFindWith.mockResolvedValue([
      {
        pageId: "page-2",
        orderNumber: "000003",
        orderName: "Bea – Custom Dress",
        currentStage: "Delivered",
        dueDate: "2026-01-05",
        stages: ["Consultation", "Fitting", "Delivered"],
      },
    ]);
    mockListPages.mockResolvedValue([
      { pageId: "m-1", stage: "Fitting", status: "Not Started" },
    ]);

    mockFindReminders.mockResolvedValue([
      {
        pageId: "m-fitting",
        stage: "Fitting",
        targetDate: "2026-01-08",
        orderPageId: "page-1",
      },
    ]);
    mockFindOrderByPage.mockResolvedValue({
      pageId: "page-1",
      orderNumber: "000002",
      orderName: "Ada – Custom Dress",
      email: "ada@example.com",
      currentStage: "Fitting",
      stages: ["Consultation", "Fitting", "Delivered"],
      lastNotifiedStage: "",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const result = await reconcileMilestones(from);

    // Generation created 2 (Fitting, Delivered) for page-1; sync advanced 1;
    // one fitting reminder went out.
    expect(result).toEqual({
      ordersProcessed: 1,
      milestonesCreated: 2,
      milestonesUpdated: 1,
      remindersSent: 1,
      paymentRemindersSent: 0,
    });
  });
});
