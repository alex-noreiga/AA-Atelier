import { describe, it, expect, vi, beforeEach } from "vitest";

// The Notion adapter is faked; the two pure helpers this service shares with the
// notifier (`isForwardStageChange` / `stagesIncludingCurrent`) are deliberately
// NOT — the point of extracting them was that both callers run the same rule, so
// stubbing them here would test a rule this service doesn't actually use.
vi.mock("../../src/lib/notion/orders.repository.js", () => ({
  findOrderForStageNotification: vi.fn(),
  listOrdersForStageBoard: vi.fn(),
  updateLastNotifiedStage: vi.fn(),
  updateOrderStage: vi.fn(),
}));

vi.mock("../../src/services/order-notification.service.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/services/order-notification.service.js")
  >("../../src/services/order-notification.service.js");
  return { ...actual, notifyOrderStageChange: vi.fn() };
});

import {
  getOrderStageBoard,
  setOrderStage,
} from "../../src/services/studio-orders.service.js";
import {
  findOrderForStageNotification,
  listOrdersForStageBoard,
  updateLastNotifiedStage,
  updateOrderStage,
  type OrderStageNotification,
} from "../../src/lib/notion/orders.repository.js";
import { notifyOrderStageChange } from "../../src/services/order-notification.service.js";
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from "../../src/lib/errors.js";

const mockFind = vi.mocked(findOrderForStageNotification);
const mockList = vi.mocked(listOrdersForStageBoard);
const mockMarker = vi.mocked(updateLastNotifiedStage);
const mockWrite = vi.mocked(updateOrderStage);
const mockNotify = vi.mocked(notifyOrderStageChange);

const STAGES = ["Consultation", "Sketching", "Sewing", "Fitting", "Delivered"];

function order(
  overrides: Partial<OrderStageNotification> = {},
): OrderStageNotification {
  return {
    pageId: "page-1",
    orderNumber: "ORD-000002",
    orderName: "Ada – Custom Costume",
    email: "ada@example.com",
    currentStage: "Sketching",
    stages: STAGES,
    lastNotifiedStage: "Sketching",
    cancelled: false,
    ...overrides,
  };
}

beforeEach(() => {
  mockFind.mockResolvedValue(order());
  mockWrite.mockResolvedValue(undefined);
  mockMarker.mockResolvedValue(undefined);
  mockNotify.mockResolvedValue({
    orderNumber: "ORD-000002",
    status: "sent",
    currentStage: "Sewing",
  });
});

describe("getOrderStageBoard", () => {
  it("reports where each order is without ever returning the email address", async () => {
    mockList.mockResolvedValue([
      order({ estimatedCompletion: "2026-09-10", service: "Repairs" }),
    ]);

    const board = await getOrderStageBoard();

    expect(board.orders).toEqual([
      {
        orderNumber: "ORD-000002",
        orderName: "Ada – Custom Costume",
        currentStage: "Sketching",
        stages: STAGES,
        nextStage: "Sewing",
        lastNotifiedStage: "Sketching",
        service: "Repairs",
        dueDate: "2026-09-10",
        notifiable: true,
      },
    ]);
    expect(JSON.stringify(board)).not.toContain("ada@example.com");
  });

  it("flags an order with no email as unreachable rather than dropping it", async () => {
    mockList.mockResolvedValue([order({ email: "" })]);

    const [row] = (await getOrderStageBoard()).orders;
    expect(row.notifiable).toBe(false);
  });

  it("offers no next stage at the end of the pipeline", async () => {
    mockList.mockResolvedValue([order({ currentStage: "Delivered" })]);

    const [row] = (await getOrderStageBoard()).orders;
    expect(row.nextStage).toBeUndefined();
  });

  // A stage the atelier renamed out of the live options is still what the order
  // says it is at. Dropping it would leave the board unable to advance the very
  // order somebody had just touched.
  it("keeps a renamed current stage on the order's own timeline", async () => {
    mockList.mockResolvedValue([order({ currentStage: "Beading (retired)" })]);

    const [row] = (await getOrderStageBoard()).orders;
    expect(row.stages).toEqual([...STAGES, "Beading (retired)"]);
    expect(row.currentStage).toBe("Beading (retired)");
  });

  it("works the nearest due date first, and puts the undated orders last", async () => {
    mockList.mockResolvedValue([
      order({ orderNumber: "ORD-3" }),
      order({ orderNumber: "ORD-1", estimatedCompletion: "2026-09-01" }),
      order({ orderNumber: "ORD-2", estimatedCompletion: "2026-08-20" }),
    ]);

    const numbers = (await getOrderStageBoard()).orders.map(
      (row) => row.orderNumber,
    );
    expect(numbers).toEqual(["ORD-2", "ORD-1", "ORD-3"]);
  });
});

describe("setOrderStage", () => {
  it("writes the stage and emails the customer through the shared notifier", async () => {
    const result = await setOrderStage("ORD-000002", { stage: "Sewing" });

    expect(mockWrite).toHaveBeenCalledWith("page-1", "Sewing");
    expect(result.changed).toBe(true);
    expect(result.previousStage).toBe("Sketching");
    expect(result.order.currentStage).toBe("Sewing");
    expect(result.notification).toBe("sent");
  });

  // The notifier re-reads the order, and a database query can lag a property
  // written a moment ago where a direct page fetch cannot — so the locator has
  // to be the page id.
  it("locates the re-read by page id, not by order number", async () => {
    await setOrderStage("ORD-000002", { stage: "Sewing" });

    expect(mockNotify).toHaveBeenCalledWith({ pageId: "page-1" });
  });

  it("advances the reported marker when the send went out", async () => {
    const result = await setOrderStage("ORD-000002", { stage: "Sewing" });

    expect(result.order.lastNotifiedStage).toBe("Sewing");
  });

  it("reports why nothing was sent when the notifier declines", async () => {
    mockNotify.mockResolvedValue({
      orderNumber: "ORD-000002",
      status: "skipped",
      reason: "not a forward stage change",
    });

    const result = await setOrderStage("ORD-000002", { stage: "Consultation" });

    expect(result.changed).toBe(true);
    expect(result.notification).toBe("skipped");
    expect(result.notificationReason).toBe("not a forward stage change");
  });

  describe("a quiet advance", () => {
    it("sends nothing but moves the marker, so the Notion automation stays quiet too", async () => {
      const result = await setOrderStage("ORD-000002", {
        stage: "Sewing",
        notify: false,
      });

      expect(mockWrite).toHaveBeenCalledWith("page-1", "Sewing");
      expect(mockNotify).not.toHaveBeenCalled();
      expect(mockMarker).toHaveBeenCalledWith("page-1", "Sewing");
      expect(result.notification).toBe("suppressed");
      expect(result.order.lastNotifiedStage).toBe("Sewing");
    });

    // The marker is a high-water mark. Rewinding it would re-arm an email for a
    // stage the customer has already been told about.
    it("never rewinds the marker on a backward move", async () => {
      const result = await setOrderStage("ORD-000002", {
        stage: "Consultation",
        notify: false,
      });

      expect(mockMarker).not.toHaveBeenCalled();
      expect(result.order.lastNotifiedStage).toBe("Sketching");
    });

    it("still reports the stage change when the marker write fails", async () => {
      mockMarker.mockRejectedValue(new Error("Notion is down"));

      const result = await setOrderStage("ORD-000002", {
        stage: "Sewing",
        notify: false,
      });

      expect(result.changed).toBe(true);
      expect(result.order.currentStage).toBe("Sewing");
    });
  });

  describe("what it refuses", () => {
    it("404s an order that doesn't exist", async () => {
      mockFind.mockResolvedValue(null);

      await expect(
        setOrderStage("ORD-nope", { stage: "Sewing" }),
      ).rejects.toBeInstanceOf(NotFoundError);
      expect(mockWrite).not.toHaveBeenCalled();
    });

    it("409s a cancelled order, whose timeline nobody is shown", async () => {
      mockFind.mockResolvedValue(order({ cancelled: true }));

      await expect(
        setOrderStage("ORD-000002", { stage: "Sewing" }),
      ).rejects.toBeInstanceOf(ConflictError);
      expect(mockWrite).not.toHaveBeenCalled();
    });

    // Not the live superset: a repair does not walk Sketching, and Notion won't
    // create a missing `status` option anyway, so an unvalidated name is a 400
    // from Notion rather than a stage change.
    it("400s a stage this order's service doesn't walk, naming what it does", async () => {
      mockFind.mockResolvedValue(
        order({
          currentStage: "Piece Received",
          stages: ["Consultation", "Piece Received", "Delivered"],
        }),
      );

      await expect(
        setOrderStage("ORD-000002", { stage: "Sketching" }),
      ).rejects.toThrow(/Piece Received/);
      await expect(
        setOrderStage("ORD-000002", { stage: "Sketching" }),
      ).rejects.toBeInstanceOf(BadRequestError);
      expect(mockWrite).not.toHaveBeenCalled();
    });

    it("400s an empty stage", async () => {
      await expect(
        setOrderStage("ORD-000002", { stage: "   " }),
      ).rejects.toBeInstanceOf(BadRequestError);
      expect(mockWrite).not.toHaveBeenCalled();
    });
  });

  // A double press must cost a request and nothing else — above all it must not
  // reach the notifier, which would be a second chance to email.
  it("writes and sends nothing when the order is already at that stage", async () => {
    const result = await setOrderStage("ORD-000002", { stage: "Sketching" });

    expect(result.changed).toBe(false);
    expect(result.notification).toBe("skipped");
    expect(mockWrite).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
  });

  // Moving an order back is the other reason the atelier used to open Notion.
  it("allows a backward correction, which the notifier then declines to email", async () => {
    mockNotify.mockResolvedValue({
      orderNumber: "ORD-000002",
      status: "skipped",
      reason: "not a forward stage change",
    });

    const result = await setOrderStage("ORD-000002", {
      stage: "Consultation",
    });

    expect(mockWrite).toHaveBeenCalledWith("page-1", "Consultation");
    expect(result.order.currentStage).toBe("Consultation");
    expect(result.notification).toBe("skipped");
  });
});
