import { describe, it, expect, vi, afterEach } from "vitest";

// The service reads the order (with its email) from the repository and dispatches
// a best-effort email. Mock both seams so the test drives the service's own logic
// (found / not-found / skip branches, the stage fixup, the sender) in isolation.
vi.mock("../../src/lib/notion/orders.repository.js", () => ({
  findOrderForStageNotification: vi.fn(),
}));
vi.mock("../../src/lib/resend/send.js", () => ({
  sendEmailBestEffort: vi.fn(),
}));

import { notifyOrderStageChange } from "../../src/services/order-notification.service.js";
import { findOrderForStageNotification } from "../../src/lib/notion/orders.repository.js";
import { sendEmailBestEffort } from "../../src/lib/resend/send.js";
import type { OrderStageNotification } from "../../src/lib/notion/orders.repository.js";

const mockFind = vi.mocked(findOrderForStageNotification);
const mockSend = vi.mocked(sendEmailBestEffort);

function order(
  overrides: Partial<OrderStageNotification> = {},
): OrderStageNotification {
  return {
    orderNumber: "000002",
    orderName: "Ada's Competition Dress",
    email: "ada@example.com",
    currentStage: "Sketching",
    stages: ["Consultation", "Sketching", "Sewing/Construction", "Delivery"],
    ...overrides,
  };
}

afterEach(() => {
  delete process.env.RESEND_FROM_EMAIL;
  delete process.env.PUBLIC_BASE_URL;
});

describe("notifyOrderStageChange", () => {
  it("returns not_found and sends nothing when the order doesn't exist", async () => {
    mockFind.mockResolvedValue(null);

    const result = await notifyOrderStageChange("  NOPE  ");

    expect(result).toEqual({ orderNumber: "NOPE", status: "not_found" });
    expect(mockSend).not.toHaveBeenCalled();
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

  it("sends a status-change email to the customer and reports the stage", async () => {
    mockFind.mockResolvedValue(order());

    const result = await notifyOrderStageChange("000002");

    expect(result).toEqual({
      orderNumber: "000002",
      status: "sent",
      currentStage: "Sketching",
    });
    expect(mockSend).toHaveBeenCalledOnce();
    const message = mockSend.mock.calls[0][0];
    expect(message.to).toBe("ada@example.com");
    expect(message.subject).toContain("Sketching");
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
      }),
    );

    await notifyOrderStageChange("000002");

    // The email's plaintext pipeline includes the out-of-list current stage.
    expect(mockSend.mock.calls[0][0].text).toContain("Archived");
  });

  it("includes a tracking link built from PUBLIC_BASE_URL, trimming a trailing slash", async () => {
    process.env.PUBLIC_BASE_URL = "https://a3iceanddance.com/";
    mockFind.mockResolvedValue(order());

    await notifyOrderStageChange("000002");

    expect(mockSend.mock.calls[0][0].text).toContain(
      "https://a3iceanddance.com/track",
    );
  });

  it("omits the tracking link when PUBLIC_BASE_URL is unset", async () => {
    mockFind.mockResolvedValue(order());

    await notifyOrderStageChange("000002");

    expect(mockSend.mock.calls[0][0].html).not.toContain("Follow your order");
  });
});
