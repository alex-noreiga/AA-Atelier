import { describe, expect, it } from "vitest";
import { resolveOrderPipeline } from "../../src/lib/order-pipeline.js";
import {
  ORDER_SERVICES,
  PIECE_IN_HAND_STAGES,
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

/** The atelier's live superset, in the order Notion lists it — the eleven
 * commission stages plus the three a piece-in-hand service needs. */
const SUPERSET = [
  "Consultation",
  "Piece Received",
  "Sketching",
  "Sourcing",
  "Pattern Design",
  "Cutting/Pinning",
  "Sewing/Construction",
  "Assembly",
  "Fitting",
  "Alteration/Adjustment",
  "Repair/Restoration",
  "Rhinestoning/Detailing",
  "Ready for delivery/pickup",
  "Delivered",
];

/** The superset as it stands in Notion before the three options are added —
 * what the deploy meets on day one. */
const SUPERSET_BEFORE_SETUP = SUPERSET.filter(
  (stage) => !PIECE_IN_HAND_STAGES.includes(stage as never),
);

describe("resolveOrderPipeline", () => {
  it("gives a bespoke commission the superset minus the piece-in-hand stages", () => {
    expect(resolveOrderPipeline("Bespoke Commission", SUPERSET)).toEqual([
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
    ]);
  });

  it("still adopts a stage the atelier adds, for the commission", () => {
    // The whole reason bespoke excludes rather than selects: the atelier can add
    // (or rename, or reorder) a commission stage in Notion with no deploy, which
    // is the property they had before pipelines existed.
    const widened = [...SUPERSET];
    widened.splice(widened.indexOf("Assembly") + 1, 0, "Lining");

    const pipeline = resolveOrderPipeline("bespoke", widened);

    expect(pipeline).toContain("Lining");
    expect(pipeline.indexOf("Lining")).toBe(pipeline.indexOf("Assembly") + 1);
  });

  it("keeps the piece-in-hand stages off a commission timeline", () => {
    const pipeline = resolveOrderPipeline("bespoke", SUPERSET);
    for (const stage of PIECE_IN_HAND_STAGES) {
      expect(pipeline).not.toContain(stage);
    }
  });

  it("narrows a repair to the stages it actually walks", () => {
    expect(resolveOrderPipeline("Repairs & Restoration", SUPERSET)).toEqual([
      "Consultation",
      "Piece Received",
      "Sourcing",
      "Repair/Restoration",
      "Ready for delivery/pickup",
      "Delivered",
    ]);
  });

  it("degrades a piece-in-hand pipeline before the Notion setup is done", () => {
    // Until the three options exist, a repair's own stages simply aren't
    // matched — the customer sees a shorter but still correct timeline rather
    // than a broken one, and adding the options in Notion completes it with no
    // deploy.
    expect(resolveOrderPipeline("repairs", SUPERSET_BEFORE_SETUP)).toEqual([
      "Consultation",
      "Sourcing",
      "Ready for delivery/pickup",
      "Delivered",
    ]);
  });

  it("keeps the catalog's declared order for a selection", () => {
    const pipeline = resolveOrderPipeline("Fittings & Alterations", SUPERSET);
    expect(pipeline).toEqual([
      "Consultation",
      "Piece Received",
      "Fitting",
      "Alteration/Adjustment",
      "Ready for delivery/pickup",
      "Delivered",
    ]);
  });

  it("keeps every declared pipeline in the superset's own order", () => {
    // Not a style rule: the Notion `Milestone Status` / `Stage Index Sys`
    // formulas index against the superset, so a pipeline that reorders relative
    // to it renders a milestone's state wrongly in the atelier's calendar. This
    // is what keeps that caveat theoretical — see the memory note.
    for (const service of ORDER_SERVICES) {
      const pipeline = resolveOrderPipeline(service.id, SUPERSET);
      const positions = pipeline.map((stage) => SUPERSET.indexOf(stage));
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
    }
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

  it("treats an absent or unknown service as a bespoke commission", () => {
    // A legacy order and an id since retired both keep the widest sensible
    // list — the commission's — rather than losing stages they might walk.
    const bespoke = resolveOrderPipeline("bespoke", SUPERSET);
    expect(resolveOrderPipeline(undefined, SUPERSET)).toEqual(bespoke);
    expect(resolveOrderPipeline("", SUPERSET)).toEqual(bespoke);
    expect(resolveOrderPipeline("embroidery", SUPERSET)).toEqual(bespoke);
  });

  it("hands a legacy order exactly the list it always had", () => {
    // An order placed before the catalog existed carries no service, and the
    // superset it was placed against was the eleven commission stages.
    expect(resolveOrderPipeline(undefined, SUPERSET_BEFORE_SETUP)).toEqual(
      SUPERSET_BEFORE_SETUP,
    );
  });

  it("drops a renamed stage but keeps the rest of the pipeline", () => {
    const renamed = SUPERSET.map((stage) =>
      stage === "Sourcing" ? "Material Sourcing" : stage,
    );
    expect(resolveOrderPipeline("repairs", renamed)).toEqual([
      "Consultation",
      "Piece Received",
      "Repair/Restoration",
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

  it("gives every selected stage a home in the live superset", () => {
    // Guards the catalog against a typo: a declared name that matches no live
    // option is silently dropped at runtime, so assert they all resolve.
    for (const service of ORDER_SERVICES) {
      if (service.pipeline?.kind !== "select") continue;
      expect(resolveOrderPipeline(service.id, SUPERSET)).toEqual([
        ...service.pipeline.stages,
      ]);
    }
  });

  it("makes the commission decide about every stage another service selects", () => {
    // The drift guard. Add a stage for one of the piece-in-hand services and
    // this fails unless the commission either walks it or excludes it — the
    // alternative being "Repair/Restoration" quietly appearing on a bespoke
    // customer's tracking page.
    const commission = resolveOrderPipeline("bespoke", SUPERSET);
    for (const service of ORDER_SERVICES) {
      if (service.pipeline?.kind !== "select") continue;
      for (const stage of service.pipeline.stages) {
        expect(
          commission.includes(stage) ||
            (PIECE_IN_HAND_STAGES as readonly string[]).includes(stage),
        ).toBe(true);
      }
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
      "Repair/Restoration",
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

  it("reads forward movement along the order's own pipeline", () => {
    // A repair last emailed about at Sourcing now reaches the mend itself. The
    // superset agrees it is forward here — but only the pipeline knows the two
    // stages are adjacent, and nothing in between was skipped.
    expect(
      isForwardStageChange("Sourcing", "Repair/Restoration", repairs),
    ).toBe(true);
    // A correction back down the pipeline still can't email.
    expect(
      isForwardStageChange("Repair/Restoration", "Sourcing", repairs),
    ).toBe(false);
    // And a stage the order will never reach can't move it at all: an
    // alteration is never at Sewing/Construction, so a stray edit to that
    // option is unknown to the pipeline and fails closed.
    expect(
      isForwardStageChange("Fitting", "Sewing/Construction", alterations),
    ).toBe(false);
  });

  it("locks measurements from the lock stage's place in the pipeline", () => {
    // The commission still locks at Cutting/Pinning exactly as before.
    const bespoke = resolveOrderPipeline("bespoke", SUPERSET);
    expect(measurementsLocked("Fitting", bespoke)).toBe(true);
    expect(measurementsLocked("Sketching", bespoke)).toBe(false);
  });

  it("fails open when the lock stage isn't in the pipeline at all", () => {
    // None of the three piece-in-hand services cut, so there is no lock point
    // on their pipelines; a change request is vetted by a human instead,
    // matching measurement-lock's documented fail-open bias. They don't collect
    // measurements at intake either, so there is nothing to freeze.
    for (const id of ["alterations", "rhinestoning", "repairs"]) {
      const service = getOrderService(id)!;
      expect(service.measurements).toBe(false);
      const pipeline = resolveOrderPipeline(id, SUPERSET);
      expect(pipeline).not.toContain("Cutting/Pinning");
      expect(measurementsLocked(pipeline[2], pipeline)).toBe(false);
    }
  });
});
