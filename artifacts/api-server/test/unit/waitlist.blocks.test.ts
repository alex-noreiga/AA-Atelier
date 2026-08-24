import { describe, it, expect } from "vitest";
import {
  WAITLIST_REQUEST_TYPE,
  buildWaitlistProperties,
  isoDateOnly,
  waitlistItemLabel,
} from "../../src/lib/notion/waitlist.blocks.js";

const base = { name: "Ada Skater", email: "Ada@Example.com" };

describe("waitlistItemLabel", () => {
  it("names the event and its date together", () => {
    expect(
      waitlistItemLabel({ eventName: "Rocket City", date: "2027-01-16" }),
    ).toBe("Rocket City (2027-01-16)");
  });

  it("falls back to whichever half it has", () => {
    expect(waitlistItemLabel({ eventName: "Rocket City" })).toBe("Rocket City");
    expect(waitlistItemLabel({ date: "2027-01-16" })).toBe("2027-01-16");
  });

  it("is empty when the customer told us neither", () => {
    expect(waitlistItemLabel({})).toBe("");
  });
});

describe("isoDateOnly", () => {
  it("narrows the Date the contract coerces to", () => {
    expect(isoDateOnly(new Date("2027-01-16T09:30:00.000Z"))).toBe(
      "2027-01-16",
    );
  });

  it("accepts a raw string too, since the coercion isn't ours to rely on", () => {
    expect(isoDateOnly("2027-01-16")).toBe("2027-01-16");
  });

  it("is empty for an absent value", () => {
    expect(isoDateOnly(undefined)).toBe("");
  });
});

describe("buildWaitlistProperties", () => {
  it("tags the row as a waitlist entry and normalizes the email", () => {
    const props = buildWaitlistProperties({ ...base });
    expect(props["Request type"]).toEqual({
      select: { name: WAITLIST_REQUEST_TYPE },
    });
    // Lowercased on every write, so a differently-cased address resolves to one
    // customer (the repo-wide rule).
    expect(props.Email).toEqual({ email: "ada@example.com" });
    expect(props.Stage).toEqual({ select: { name: "New" } });
  });

  it("names who is waiting and what for in the subject", () => {
    const props = buildWaitlistProperties({
      ...base,
      target: { eventName: "Rocket City", date: "2027-01-16" },
    });
    expect(props["Message (subject)"]).toEqual({
      title: [
        {
          text: { content: "Waitlist: Ada Skater — Rocket City (2027-01-16)" },
        },
      ],
    });
  });

  it("carries the event on the shared Item property, so the inbox can group by it", () => {
    const props = buildWaitlistProperties({
      ...base,
      target: { eventName: "Rocket City", date: "2027-01-16" },
    });
    expect(props.Item).toEqual({
      rich_text: [{ text: { content: "Rocket City (2027-01-16)" } }],
    });
  });

  it("omits Item entirely rather than writing it blank", () => {
    const props = buildWaitlistProperties({ ...base });
    expect(props).not.toHaveProperty("Item");
    expect(props["Message (subject)"]).toEqual({
      title: [{ text: { content: "Waitlist: Ada Skater" } }],
    });
  });

  it("writes a body the atelier reads the same way every time", () => {
    const props = buildWaitlistProperties({
      ...base,
      notes: "  Lyrical dress, deep teal.  ",
      target: { date: "2027-01-16" },
    });
    expect(props.Message).toEqual({
      rich_text: [
        {
          text: {
            content: "Waiting for: 2027-01-16\n\nLyrical dress, deep teal.",
          },
        },
      ],
    });
  });

  it("says so plainly when nothing was specified", () => {
    const props = buildWaitlistProperties({ ...base });
    expect(props.Message).toEqual({
      rich_text: [{ text: { content: "Waiting for: (not specified)" } }],
    });
  });

  it("links the Client CRM record when one was resolved", () => {
    const props = buildWaitlistProperties({ ...base }, "client-1");
    expect(props.Client).toEqual({ relation: [{ id: "client-1" }] });
  });

  it("omits the client relation when the CRM is off", () => {
    expect(buildWaitlistProperties({ ...base })).not.toHaveProperty("Client");
  });

  it("includes the phone only when given", () => {
    expect(
      buildWaitlistProperties({ ...base, phone: "+1 555 0100" }).Phone,
    ).toEqual({ phone_number: "+1 555 0100" });
    expect(buildWaitlistProperties({ ...base })).not.toHaveProperty("Phone");
  });
});
