import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Notion repositories so the orchestration runs without network, and
// silence the logger so the per-order error path doesn't spam test output.
vi.mock("../../src/lib/notion/orders.repository.js", () => ({
  findOrdersNeedingMilestones: vi.fn(),
  findOrdersWithMilestones: vi.fn(),
  markMilestonesGenerated: vi.fn(),
}));
vi.mock("../../src/lib/notion/production-schedule.repository.js", () => ({
  createMilestone: vi.fn(),
  orderHasMilestones: vi.fn(),
  listOrderMilestonePages: vi.fn(),
  updateMilestoneStatus: vi.fn(),
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
  reconcileMilestones,
} from "../../src/services/schedule.service.js";
import {
  findOrdersNeedingMilestones,
  findOrdersWithMilestones,
  markMilestonesGenerated,
  type PendingMilestoneOrder,
} from "../../src/lib/notion/orders.repository.js";
import {
  createMilestone,
  orderHasMilestones,
  listOrderMilestonePages,
  updateMilestoneStatus,
} from "../../src/lib/notion/production-schedule.repository.js";
import { logger } from "../../src/lib/logger.js";

const mockFind = vi.mocked(findOrdersNeedingMilestones);
const mockFindWith = vi.mocked(findOrdersWithMilestones);
const mockMark = vi.mocked(markMilestonesGenerated);
const mockCreate = vi.mocked(createMilestone);
const mockHas = vi.mocked(orderHasMilestones);
const mockListPages = vi.mocked(listOrderMilestonePages);
const mockUpdateStatus = vi.mocked(updateMilestoneStatus);

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

describe("reconcileMilestones", () => {
  beforeEach(() => {
    mockHas.mockResolvedValue(false);
    mockCreate.mockResolvedValue();
    mockMark.mockResolvedValue();
    mockUpdateStatus.mockResolvedValue();
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

    const result = await reconcileMilestones(from);

    // Generation created 2 (Fitting, Delivered) for page-1; sync advanced 1.
    expect(result).toEqual({
      ordersProcessed: 1,
      milestonesCreated: 2,
      milestonesUpdated: 1,
    });
  });
});
