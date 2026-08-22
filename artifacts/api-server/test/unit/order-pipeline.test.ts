import { describe, expect, it } from "vitest";
import { resolveOrderPipeline } from "../../src/lib/order-pipeline.js";
import {
  ORDER_SERVICES,
  getOrderService,
  resolveStoredOrderService,
} from "../../src/lib/service-catalog.js";
import {
  orderDelivered,
  orderLifecycleState,
} from "../../src/services/delivery.js";
import { measurementsLocked } from "../../src/services/measurement-lock.js";
import { isForwardStageChange } from "../../src/services/order-notification.service.js";
import {
  computeMilestoneSchedule,
  remainingStages,
} from "../../src/services/schedule.service.js";

/** The atelier's live superset, in the order Notion lists it. */
const SUPERSET = [
  "Consultation",
  "Sketching",
  "Sourcing",
  "Pattern Design",
  "Cutting/Pinning",
  "Sewing/Construction",
  "Assembly",
  "Fitting",
  "Rhinestoning/Detailing",
  "Ready for delivery/pickup",
  "Delivered",
];

describe("resolveOrderPipeline", () => {
  it("gives a bespoke commission the whole live list", () => {
    expect(resolveOrderPipeline("Bespoke Commission", SUPERSET)).toEqual(
      SUPERSET,
    );
  });

  it("narrows a repair to the stages it actually walks", () => {
    expect(resolveOrderPipeline("Repairs & Restoration", SUPERSET)).toEqual([
      "Consultation",
      "Sourcing",
      "Sewing/Construction",
      "Ready for delivery/pickup",
      "Delivered",
    ]);
  });

  it("keeps the catalog's declared order, not the live list's", () => {
    // The point of a declared sequence: an alteration is fitted before it is
    // cut, which is the reverse of how the superset lists those two.
    const pipeline = resolveOrderPipeline("Fittings & Alterations", SUPERSET);
    expect(pipeline.indexOf("Fitting")).toBeLessThan(
      pipeline.indexOf("Cutting/Pinning"),
    );
    expect(SUPERSET.indexOf("Fitting")).toBeGreaterThan(
      SUPERSET.indexOf("Cutting/Pinning"),
    );
  });

  it("resolves a service by its catalog id as well as its stored name", () => {
    expect(resolveOrderPipeline("repairs", SUPERSET)).toEqual(
      resolveOrderPipeline("Repairs & Restoration", SUPERSET),
    );
  });

  it("matches a stored name case- and whitespace-insensitively", () => {
    expect(
      resolveOrderPipeline("  rhinestoning & EMBELLISHMENT ", SUPERSET),
    ).toEqual(resolveOrderPipeline("rhinestoning", SUPERSET));
  });

  it("falls back to the whole list for an absent or unknown service", () => {
    // A legacy order, and an id since retired: both keep the widest list rather
    // than losing stages they might still walk.
    expect(resolveOrderPipeline(undefined, SUPERSET)).toEqual(SUPERSET);
    expect(resolveOrderPipeline("", SUPERSET)).toEqual(SUPERSET);
    expect(resolveOrderPipeline("embroidery", SUPERSET)).toEqual(SUPERSET);
  });

  it("drops a renamed stage but keeps the rest of the pipeline", () => {
    const renamed = SUPERSET.map((stage) =>
      stage === "Sourcing" ? "Material Sourcing" : stage,
    );
    expect(resolveOrderPipeline("repairs", renamed)).toEqual([
      "Consultation",
      "Sewing/Construction",
      "Ready for delivery/pickup",
      "Delivered",
    ]);
  });

  it("falls back to the live list when nothing matches at all", () => {
    // A wholesale rename. An empty pipeline would report the order as never
    // delivered and render a timeline with no steps, so serve the stale-but-
    // whole list instead.
    const renamed = ["Intake", "Making", "Handover"];
    expect(resolveOrderPipeline("repairs", renamed)).toEqual(renamed);
  });

  it("never invents a stage the live list doesn't have", () => {
    for (const service of ORDER_SERVICES) {
      const pipeline = resolveOrderPipeline(service.name, SUPERSET);
      expect(SUPERSET).toEqual(expect.arrayContaining(pipeline));
    }
  });

  it("gives every declared pipeline a home in the live superset", () => {
    // Guards the catalog against a typo: a declared name that matches no live
    // option is silently dropped at runtime, so assert they all resolve.
    for (const service of ORDER_SERVICES) {
      if (!service.pipeline) continue;
      expect(resolveOrderPipeline(service.id, SUPERSET)).toEqual([
        ...service.pipeline,
      ]);
    }
  });
});

describe("resolveStoredOrderService", () => {
  it("reads back what buildOrderProperties writes (the display name)", () => {
    for (const service of ORDER_SERVICES) {
      expect(resolveStoredOrderService(service.name).id).toBe(service.id);
    }
  });
});

// The four positional rules take the stage list as an argument, so pointing
// them at the order's pipeline is the whole of the behavior change. These lock
// in what that buys, per rule.
describe("the positional rules over a service pipeline", () => {
  const repairs = resolveOrderPipeline("repairs", SUPERSET);
  const alterations = resolveOrderPipeline("alterations", SUPERSET);

  it("delivers a repair at the end of its own pipeline", () => {
    expect(orderDelivered("Delivered", repairs)).toBe(true);
    // Still not delivered a stage early, and the commission's extra stages
    // aren't in the way.
    expect(orderDelivered("Ready for delivery/pickup", repairs)).toBe(false);
    expect(orderLifecycleState(false, "Delivered", repairs)).toBe("completed");
  });

  it("schedules milestones only for the stages a repair walks", () => {
    const remaining = remainingStages(repairs, "Sourcing");
    expect(remaining).toEqual([
      "Sourcing",
      "Sewing/Construction",
      "Ready for delivery/pickup",
      "Delivered",
    ]);

    const schedule = computeMilestoneSchedule(
      new Date("2026-10-01T00:00:00.000Z"),
      remaining,
      new Date("2026-09-01T00:00:00.000Z"),
    );
    expect(schedule.map((m) => m.stage)).toEqual(remaining);
    // The last stage of the order's own pipeline lands on the due date.
    expect(schedule.at(-1)).toEqual({
      stage: "Delivered",
      targetDate: "2026-10-01",
    });
  });

  it("reads forward movement along the pipeline, not the superset", () => {
    // An alteration last emailed about at its fitting now reaches cutting.
    // Against the superset that reads as a *backward* edit and is silently
    // dropped — the customer never hears the piece went into production. Against
    // the order's own pipeline it is the forward move it actually is.
    expect(isForwardStageChange("Fitting", "Cutting/Pinning", SUPERSET)).toBe(
      false,
    );
    expect(
      isForwardStageChange("Fitting", "Cutting/Pinning", alterations),
    ).toBe(true);
    // And the reverse move stays backward, so a correction still can't email.
    expect(
      isForwardStageChange("Cutting/Pinning", "Fitting", alterations),
    ).toBe(false);
  });

  it("locks measurements from the lock stage's place in the pipeline", () => {
    // Alterations reach Cutting/Pinning after the fitting, so a fitting-stage
    // order is still unlocked there while the same stage is past the lock in
    // the commission list.
    expect(measurementsLocked("Fitting", alterations)).toBe(false);
    expect(measurementsLocked("Fitting", SUPERSET)).toBe(true);
    expect(measurementsLocked("Sewing/Construction", alterations)).toBe(true);
  });

  it("fails open when the lock stage isn't in the pipeline at all", () => {
    // Repairs never cut, so there is no lock point; the change request is
    // vetted by a human instead, matching measurement-lock's documented bias.
    expect(getOrderService("repairs")?.pipeline).not.toContain(
      "Cutting/Pinning",
    );
    expect(measurementsLocked("Sewing/Construction", repairs)).toBe(false);
  });
});
