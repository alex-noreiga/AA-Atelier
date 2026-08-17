import { describe, it, expect } from "vitest";
import {
  orderDelivered,
  orderLifecycleState,
} from "../../src/services/delivery.js";

const STAGES = ["Consultation", "Sketching", "Cutting/Pinning", "Delivery"];

describe("orderDelivered", () => {
  it("is true when the current stage is the final stage", () => {
    expect(orderDelivered("Delivery", STAGES)).toBe(true);
  });

  it("is false for any stage before the final one", () => {
    expect(orderDelivered("Consultation", STAGES)).toBe(false);
    expect(orderDelivered("Cutting/Pinning", STAGES)).toBe(false);
  });

  it("fails closed when the current stage isn't in the live list", () => {
    expect(orderDelivered("Some Renamed Stage", STAGES)).toBe(false);
  });

  it("fails closed when the stage list is empty", () => {
    expect(orderDelivered("Delivery", [])).toBe(false);
  });

  it("tracks the final stage positionally, not by name (survives a rename)", () => {
    // The atelier renamed the last stage; it's still the delivered state.
    const renamed = ["Consultation", "Sketching", "Shipped to you"];
    expect(orderDelivered("Shipped to you", renamed)).toBe(true);
    expect(orderDelivered("Delivery", renamed)).toBe(false);
  });
});

describe("orderLifecycleState", () => {
  it("is active while the order is still moving through the list", () => {
    expect(orderLifecycleState(false, "Sketching", STAGES)).toBe("active");
  });

  it("is completed at the final stage/status", () => {
    expect(orderLifecycleState(false, "Delivery", STAGES)).toBe("completed");
  });

  it("is cancelled whenever the order is cancelled, wherever it got to", () => {
    expect(orderLifecycleState(true, "Sketching", STAGES)).toBe("cancelled");
    // Cancellation wins over completion (a shop order can be cancelled late).
    expect(orderLifecycleState(true, "Delivery", STAGES)).toBe("cancelled");
  });

  it("falls back to active on an unknown stage or an empty list", () => {
    expect(orderLifecycleState(false, "Renamed", STAGES)).toBe("active");
    expect(orderLifecycleState(false, "Delivery", [])).toBe("active");
  });
});
