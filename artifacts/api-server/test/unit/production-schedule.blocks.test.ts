import { describe, it, expect } from "vitest";
import {
  buildMilestoneProperties,
  PRODUCTION_SCHEDULE_INITIAL_STATUS,
  PS_TITLE_PROPERTY,
  PS_STAGE_PROPERTY,
  PS_STATUS_PROPERTY,
  PS_TARGET_DATE_PROPERTY,
  PS_ORDER_RELATION_PROPERTY,
  type MilestoneInput,
} from "../../src/lib/notion/production-schedule.blocks.js";

const base: MilestoneInput = {
  orderPageId: "order-page-1",
  projectName: "Ada – Custom Dress — Fitting",
  stage: "Fitting",
  targetDate: "2026-08-15",
};

describe("buildMilestoneProperties", () => {
  it("maps every field to the matching Notion property type", () => {
    const props = buildMilestoneProperties(base) as Record<string, any>;

    expect(props[PS_TITLE_PROPERTY].title[0].text.content).toBe(
      "Ada – Custom Dress — Fitting",
    );
    // Stage is a select so Notion auto-creates the option (no hardcoded list).
    expect(props[PS_STAGE_PROPERTY]).toEqual({ select: { name: "Fitting" } });
    expect(props[PS_TARGET_DATE_PROPERTY]).toEqual({
      date: { start: "2026-08-15" },
    });
    expect(props[PS_STATUS_PROPERTY]).toEqual({
      status: { name: PRODUCTION_SCHEDULE_INITIAL_STATUS },
    });
    // The relation links the milestone back to its order page.
    expect(props[PS_ORDER_RELATION_PROPERTY]).toEqual({
      relation: [{ id: "order-page-1" }],
    });
  });

  it("writes only the lean set of properties (no client name / due-date dupes)", () => {
    const props = buildMilestoneProperties(base) as Record<string, unknown>;
    expect(Object.keys(props).sort()).toEqual(
      [
        PS_TITLE_PROPERTY,
        PS_STAGE_PROPERTY,
        PS_TARGET_DATE_PROPERTY,
        PS_STATUS_PROPERTY,
        PS_ORDER_RELATION_PROPERTY,
      ].sort(),
    );
  });
});
