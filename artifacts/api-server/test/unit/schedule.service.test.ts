import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Notion repositories so the orchestration runs without network, and
// silence the logger so the per-order error path doesn't spam test output.
vi.mock("../../src/lib/notion/orders.repository.js", () => ({
  findOrdersNeedingMilestones: vi.fn(),
  markMilestonesGenerated: vi.fn(),
}));
vi.mock("../../src/lib/notion/production-schedule.repository.js", () => ({
  createMilestone: vi.fn(),
  orderHasMilestones: vi.fn(),
}));
vi.mock("../../src/lib/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import {
  computeMilestoneSchedule,
  remainingStages,
  generatePendingMilestones,
} from "../../src/services/schedule.service.js";
import {
  findOrdersNeedingMilestones,
  markMilestonesGenerated,
  type PendingMilestoneOrder,
} from "../../src/lib/notion/orders.repository.js";
import {
  createMilestone,
  orderHasMilestones,
} from "../../src/lib/notion/production-schedule.repository.js";
import { logger } from "../../src/lib/logger.js";

const mockFind = vi.mocked(findOrdersNeedingMilestones);
const mockMark = vi.mocked(markMilestonesGenerated);
const mockCreate = vi.mocked(createMilestone);
const mockHas = vi.mocked(orderHasMilestones);

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
    // Client name is stripped from the "{name} – Custom Dress" order name.
    expect(mockCreate.mock.calls[0][0]).toMatchObject({
      orderPageId: "page-1",
      clientName: "Ada",
      projectName: "Ada – Custom Dress — Fitting",
      dueDate: "2026-01-11",
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
