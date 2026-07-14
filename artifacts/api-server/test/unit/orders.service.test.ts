import { describe, it, expect, vi } from "vitest";
import { createOrderInput, orderRecord } from "@workspace/test-fixtures";
import type { OrderRecord } from "../../src/lib/notion/schema.js";

// The service talks to the repository by direct import, so mock that module to
// exercise the service's own logic (the missing-order and out-of-list-stage
// branches) in isolation.
vi.mock("../../src/lib/notion/orders.repository.js", () => ({
  findOrderByNumber: vi.fn(),
  createOrder: vi.fn(),
}));

// The confirmation email is a best-effort side effect; mock it so the service
// test asserts it is dispatched without touching the Resend transport.
vi.mock("../../src/lib/resend/send.js", () => ({
  sendEmailBestEffort: vi.fn(),
}));

import {
  getOrderStatus,
  submitOrder,
} from "../../src/services/orders.service.js";
import {
  findOrderByNumber,
  createOrder,
} from "../../src/lib/notion/orders.repository.js";
import { sendEmailBestEffort } from "../../src/lib/resend/send.js";
import { NotFoundError } from "../../src/lib/errors.js";

const mockFind = vi.mocked(findOrderByNumber);
const mockCreate = vi.mocked(createOrder);
const mockSend = vi.mocked(sendEmailBestEffort);

describe("getOrderStatus", () => {
  it("throws NotFoundError when the order does not exist", async () => {
    mockFind.mockResolvedValue(null);
    await expect(getOrderStatus("ORD-MISSING")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("returns the record unchanged when the current stage is in the list", async () => {
    const record: OrderRecord = orderRecord({
      orderNumber: "000002",
      currentStage: "Sewing",
      stages: ["Consultation", "Sewing", "Delivery"],
    });
    mockFind.mockResolvedValue(record);

    const result = await getOrderStatus("000002");
    expect(result.stages).toEqual(["Consultation", "Sewing", "Delivery"]);
  });

  it("appends the current stage when it is missing from the live list", async () => {
    // Guards against a stage option that was renamed/removed in Notion after
    // the order was set to it — the timeline must still show where it is.
    mockFind.mockResolvedValue(
      orderRecord({
        orderNumber: "000002",
        currentStage: "Archived",
        stages: ["Consultation", "Sewing", "Delivery"],
      }),
    );

    const result = await getOrderStatus("000002");
    expect(result.stages).toEqual([
      "Consultation",
      "Sewing",
      "Delivery",
      "Archived",
    ]);
  });
});

describe("submitOrder", () => {
  it("delegates to the repository and returns the new order number", async () => {
    mockCreate.mockResolvedValue("ORD-XYZ-987");
    const result = await submitOrder(
      createOrderInput({ email: "ada@example.com" }),
    );
    expect(result).toEqual({ orderNumber: "ORD-XYZ-987" });
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it("dispatches a confirmation email to the customer after creating the order", async () => {
    mockCreate.mockResolvedValue("ORD-XYZ-987");

    await submitOrder(createOrderInput({ email: "ada@example.com" }));

    expect(mockSend).toHaveBeenCalledOnce();
    const message = mockSend.mock.calls[0][0];
    expect(message.to).toBe("ada@example.com");
    expect(message.subject).toContain("ORD-XYZ-987");
  });
});
