import { describe, it, expect, vi, afterEach } from "vitest";

// The service reads the order (with its email + last-notified marker) from the
// repository, gates the send to forward movement, dispatches a best-effort email,
// and advances the marker. Mock those seams so the test drives the service's own
// logic (found / not-found / skip / forward-only / force / marker write) in
// isolation.
vi.mock("../../src/lib/notion/orders.repository.js", () => ({
  findOrderForStageNotification: vi.fn(),
  findOrderForStageNotificationByPageId: vi.fn(),
  updateLastNotifiedStage: vi.fn(),
}));
vi.mock("../../src/lib/resend/send.js", () => ({
  sendEmailBestEffort: vi.fn(),
}));

import {
  notifyOrderStageChange,
  isForwardStageChange,
} from "../../src/services/order-notification.service.js";
import {
  findOrderForStageNotification,
  findOrderForStageNotificationByPageId,
  updateLastNotifiedStage,
} from "../../src/lib/notion/orders.repository.js";
import { sendEmailBestEffort } from "../../src/lib/resend/send.js";
import type { OrderStageNotification } from "../../src/lib/notion/orders.repository.js";

const mockFind = vi.mocked(findOrderForStageNotification);
const mockFindByPageId = vi.mocked(findOrderForStageNotificationByPageId);
const mockUpdateMarker = vi.mocked(updateLastNotifiedStage);
const mockSend = vi.mocked(sendEmailBestEffort);

function order(
  overrides: Partial<OrderStageNotification> = {},
): OrderStageNotification {
  return {
    pageId: "order-page-1",
    orderNumber: "000002",
    orderName: "Ada's Competition Dress",
    email: "ada@example.com",
    currentStage: "Sketching",
    stages: ["Consultation", "Sketching", "Sewing/Construction", "Delivery"],
    lastNotifiedStage: "Consultation",
    cancelled: false,
    ...overrides,
  };
}

afterEach(() => {
  delete process.env.RESEND_FROM_EMAIL;
  delete process.env.PUBLIC_BASE_URL;
});

describe("isForwardStageChange", () => {
  const stages = ["Consultation", "Sketching", "Sewing", "Delivery"];

  it("is forward when the current stage is later in the pipeline", () => {
    expect(isForwardStageChange("Sketching", "Delivery", stages)).toBe(true);
  });

  it("is NOT forward when the current stage is earlier (a backward move)", () => {
    expect(isForwardStageChange("Delivery", "Sketching", stages)).toBe(false);
  });

  it("is NOT forward when the stage is unchanged (a re-fire)", () => {
    expect(isForwardStageChange("Sketching", "Sketching", stages)).toBe(false);
  });

  it("is forward on first notification (empty marker)", () => {
    expect(isForwardStageChange("", "Consultation", stages)).toBe(true);
  });

  it("is NOT forward when the marker isn't in the list (can't compare)", () => {
    expect(isForwardStageChange("Renamed", "Sketching", stages)).toBe(false);
  });
});

describe("notifyOrderStageChange", () => {
  it("returns not_found and sends nothing when the order doesn't exist", async () => {
    mockFind.mockResolvedValue(null);

    const result = await notifyOrderStageChange("  NOPE  ");

    expect(result).toEqual({ orderNumber: "NOPE", status: "not_found" });
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockUpdateMarker).not.toHaveBeenCalled();
  });

  it("skips (no send) when the order has no email", async () => {
    mockFind.mockResolvedValue(order({ email: "" }));

    const result = await notifyOrderStageChange("000002");

    expect(result.status).toBe("skipped");
    expect(result.reason).toMatch(/email/);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("skips (no send) when the order has no stage set", async () => {
    mockFind.mockResolvedValue(order({ currentStage: "" }));

    const result = await notifyOrderStageChange("000002");

    expect(result.status).toBe("skipped");
    expect(result.reason).toMatch(/stage/);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("sends on a forward move and advances the marker to the current stage", async () => {
    mockFind.mockResolvedValue(
      order({ currentStage: "Sketching", lastNotifiedStage: "Consultation" }),
    );

    const result = await notifyOrderStageChange("000002");

    expect(result).toEqual({
      orderNumber: "000002",
      status: "sent",
      currentStage: "Sketching",
    });
    expect(mockSend).toHaveBeenCalledOnce();
    expect(mockSend.mock.calls[0][0].to).toBe("ada@example.com");
    expect(mockUpdateMarker).toHaveBeenCalledWith("order-page-1", "Sketching");
  });

  it("locates the order by page id and sends (Notion default payload)", async () => {
    mockFindByPageId.mockResolvedValue(
      order({ currentStage: "Sketching", lastNotifiedStage: "Consultation" }),
    );

    const result = await notifyOrderStageChange({ pageId: "page-xyz" });

    expect(mockFindByPageId).toHaveBeenCalledWith("page-xyz");
    expect(mockFind).not.toHaveBeenCalled();
    expect(result.status).toBe("sent");
    expect(mockSend).toHaveBeenCalledOnce();
  });

  it("returns not_found (empty orderNumber) when a page-id lookup misses", async () => {
    mockFindByPageId.mockResolvedValue(null);

    const result = await notifyOrderStageChange({ pageId: "page-xyz" });

    expect(result).toEqual({ orderNumber: "", status: "not_found" });
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("accepts an { orderNumber } locator object", async () => {
    mockFind.mockResolvedValue(order());

    const result = await notifyOrderStageChange({ orderNumber: "000002" });

    expect(mockFind).toHaveBeenCalledWith("000002");
    expect(result.status).toBe("sent");
  });

  it("sends on the first notification (empty marker)", async () => {
    mockFind.mockResolvedValue(
      order({ currentStage: "Consultation", lastNotifiedStage: "" }),
    );

    const result = await notifyOrderStageChange("000002");

    expect(result.status).toBe("sent");
    expect(mockSend).toHaveBeenCalledOnce();
    expect(mockUpdateMarker).toHaveBeenCalledWith(
      "order-page-1",
      "Consultation",
    );
  });

  it("does NOT send (or advance the marker) on a backward move", async () => {
    mockFind.mockResolvedValue(
      order({ currentStage: "Sketching", lastNotifiedStage: "Delivery" }),
    );

    const result = await notifyOrderStageChange("000002");

    expect(result.status).toBe("skipped");
    expect(result.reason).toMatch(/forward/);
    expect(result.currentStage).toBe("Sketching");
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockUpdateMarker).not.toHaveBeenCalled();
  });

  it("does NOT send when the stage is unchanged (a re-fire of the same stage)", async () => {
    mockFind.mockResolvedValue(
      order({ currentStage: "Sketching", lastNotifiedStage: "Sketching" }),
    );

    const result = await notifyOrderStageChange("000002");

    expect(result.status).toBe("skipped");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("force resends on a non-forward move but never moves the marker backward", async () => {
    mockFind.mockResolvedValue(
      order({ currentStage: "Sketching", lastNotifiedStage: "Delivery" }),
    );

    const result = await notifyOrderStageChange("000002", { force: true });

    expect(result.status).toBe("sent");
    expect(mockSend).toHaveBeenCalledOnce();
    // A forced backward/same resend must not advance (rewind) the high-water mark.
    expect(mockUpdateMarker).not.toHaveBeenCalled();
  });

  it("still returns sent when advancing the marker fails (best-effort write)", async () => {
    mockFind.mockResolvedValue(order());
    mockUpdateMarker.mockRejectedValue(new Error("Notion PATCH failed"));

    const result = await notifyOrderStageChange("000002");

    expect(result.status).toBe("sent");
    expect(mockSend).toHaveBeenCalledOnce();
  });

  it("sends from the orders sender (orders@…)", async () => {
    process.env.RESEND_FROM_EMAIL = "A.A Atelier <orders@a3iceanddance.com>";
    mockFind.mockResolvedValue(order());

    await notifyOrderStageChange("000002");

    expect(mockSend.mock.calls[0][0].from).toBe(
      "A.A Atelier <orders@a3iceanddance.com>",
    );
  });

  it("appends the current stage to the pipeline when it's missing from the live list", async () => {
    mockFind.mockResolvedValue(
      order({
        currentStage: "Archived",
        stages: ["Consultation", "Sketching", "Delivery"],
        lastNotifiedStage: "Consultation",
      }),
    );

    await notifyOrderStageChange("000002");

    // Out-of-list current stage lands last → still forward → sends, pipeline shows it.
    expect(mockSend.mock.calls[0][0].text).toContain("Archived");
  });

  it("builds a direct order tracking link from PUBLIC_BASE_URL, trimming a trailing slash", async () => {
    process.env.PUBLIC_BASE_URL = "https://a3iceanddance.com/";
    mockFind.mockResolvedValue(order({ orderNumber: "000002" }));

    await notifyOrderStageChange("000002");

    // Deep-links straight to this order via the track page's ?orderNumber= param.
    expect(mockSend.mock.calls[0][0].text).toContain(
      "https://a3iceanddance.com/track?orderNumber=000002",
    );
  });

  it("omits the tracking link when PUBLIC_BASE_URL is unset", async () => {
    mockFind.mockResolvedValue(order());

    await notifyOrderStageChange("000002");

    expect(mockSend.mock.calls[0][0].html).not.toContain("tracking page");
  });
});
