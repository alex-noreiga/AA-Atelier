// The pure SMS business rules: reading a typed phone number as E.164, and
// deciding which stage is the "on its way" moment. Both fail closed, and these
// pin that — a number we can't read must yield nothing rather than a guess.

import { describe, expect, it, afterEach } from "vitest";
import {
  clampField,
  isShippedStage,
  toE164,
  SMS_SEGMENT_LIMIT,
} from "../../src/services/sms.js";

describe("toE164", () => {
  it("reads the shapes a US customer actually types", () => {
    expect(toE164("512-555-0123")).toBe("+15125550123");
    expect(toE164("(512) 555-0123")).toBe("+15125550123");
    expect(toE164("512.555.0123")).toBe("+15125550123");
    expect(toE164("5125550123")).toBe("+15125550123");
    expect(toE164(" 1 512 555 0123 ")).toBe("+15125550123");
  });

  it("keeps an explicit country code as given", () => {
    expect(toE164("+44 20 7946 0958")).toBe("+442079460958");
    expect(toE164("+1 (512) 555-0123")).toBe("+15125550123");
  });

  it("returns nothing for anything it can't read, rather than guessing", () => {
    expect(toE164("")).toBe("");
    expect(toE164("   ")).toBe("");
    expect(toE164("call me")).toBe("");
    // Too short to be a number, and too long to be one.
    expect(toE164("555-0123")).toBe("");
    expect(toE164("+1")).toBe("");
    expect(toE164("+1234567890123456")).toBe("");
    // An 11-digit number that isn't a US one — we don't know its country.
    expect(toE164("44207946095")).toBe("");
  });
});

describe("isShippedStage", () => {
  afterEach(() => {
    delete process.env.SMS_SHIPPED_STAGES;
  });

  it("fires on the default ready stage, case- and space-insensitively", () => {
    expect(isShippedStage("Ready for delivery/pickup")).toBe(true);
    expect(isShippedStage("  ready for delivery/pickup ")).toBe(true);
  });

  it("does not fire on the other stages of the pipeline", () => {
    for (const stage of [
      "Consultation",
      "Sewing/Construction",
      "Fitting",
      "Delivered",
      "",
    ]) {
      expect(isShippedStage(stage)).toBe(false);
    }
  });

  it("follows the override when the atelier renames the stage", () => {
    process.env.SMS_SHIPPED_STAGES = "Boxed up, Off to the post";
    expect(isShippedStage("Boxed up")).toBe(true);
    expect(isShippedStage("Off to the post")).toBe(true);
    expect(isShippedStage("Ready for delivery/pickup")).toBe(false);
  });

  it("falls back to the default for a blank override", () => {
    process.env.SMS_SHIPPED_STAGES = "   ";
    expect(isShippedStage("Ready for delivery/pickup")).toBe(true);
  });
});

describe("clampField", () => {
  it("leaves a field that fits alone", () => {
    expect(clampField("Ada", 20)).toBe("Ada");
    expect(clampField("  Ada  ", 20)).toBe("Ada");
  });

  it("trims a long one on a word boundary, never past the limit", () => {
    // The break lands on the space after "Wilhelmina", so no half-word shows.
    const clamped = clampField("Alexandra Wilhelmina Fitzgerald", 24);
    expect(clamped).toBe("Alexandra Wilhelmina…");
    expect(clamped.length).toBeLessThanOrEqual(24);
  });

  it("trims mid-word rather than losing most of the field", () => {
    // The only space is too early to break on — cutting there would throw away
    // more of the name than it kept — so the cut is taken as-is.
    expect(clampField("Al Wilhelminafitzgerald", 12)).toBe("Al Wilhelmi…");
    expect(clampField("Aaaaaaaaaaaaaaaaaaaaaa", 10)).toBe("Aaaaaaaaa…");
  });

  it("holds a segment limit worth clamping against", () => {
    expect(SMS_SEGMENT_LIMIT).toBe(160);
  });
});

// --- The copy ---------------------------------------------------------------
//
// Every message names the studio first (it arrives from a number nobody has
// saved), carries the opt-out, and links out rather than repeating the email.

describe("the message copy", () => {
  it("reads a payment reminder as a sentence, with the label lowercased", async () => {
    const { paymentDueSms } = await import("../../src/lib/twilio/messages.js");
    const { body } = paymentDueSms({
      to: "+15125550123",
      orderNumber: "ORD-000002",
      // `paymentStageLabel` hands over a capitalized label; mid-sentence it has
      // to read as one, exactly as the email builder makes it.
      stageLabel: "Final balance",
      dueDate: "2026-09-03",
      overdue: false,
      amount: 450,
      payUrl: "https://a3iceanddance.com/track?orderNumber=ORD-000002",
    });

    expect(body).toBe(
      "A.A Atelier: Your final balance ($450) for ORD-000002 is due " +
        "September 3. Pay: https://a3iceanddance.com/track?orderNumber=ORD-000002 " +
        "Reply STOP to opt out.",
    );
  });

  it("says a passed date was due, not is due", async () => {
    const { paymentDueSms } = await import("../../src/lib/twilio/messages.js");
    const { body } = paymentDueSms({
      to: "+15125550123",
      orderNumber: "ORD-000002",
      stageLabel: "First deposit",
      dueDate: "2026-08-01",
      overdue: true,
    });

    expect(body).toContain("was due August 1");
    // No amount on the invoice yet ⇒ no parenthetical, not "($undefined)".
    expect(body).not.toContain("(");
  });

  it("points at the email when there is no public base URL to link to", async () => {
    const { appointmentReminderSms } =
      await import("../../src/lib/twilio/messages.js");
    const { body } = appointmentReminderSms({
      to: "+15125550123",
      typeName: "fitting",
      whenPhrase: "tomorrow",
      time: "10:00 AM CDT",
      locationLabel: "The studio",
    });

    // There is always a fuller version of this already in the inbox.
    expect(body).toContain("Details are in the email we've just sent.");
    expect(body).toContain("A.A Atelier: Your fitting is tomorrow at 10:00 AM");
  });

  it("never calls a collection a shipment", async () => {
    const { orderReadySms } = await import("../../src/lib/twilio/messages.js");
    const { body } = orderReadySms({
      to: "+15125550123",
      firstName: "Ada",
      orderNumber: "ORD-000002",
      trackingUrl: "https://a3iceanddance.com/track?orderNumber=ORD-000002",
    });

    // The stage this fires on covers a posted parcel AND a pickup at the studio.
    expect(body).toContain("Ada, your order ORD-000002 is finished and ready.");
    expect(body).not.toMatch(/shipp?ed|posted|on its way/i);
  });

  it("ends every message with the opt-out", async () => {
    const messages = await import("../../src/lib/twilio/messages.js");
    const bodies = [
      messages.paymentDueSms({
        to: "+1",
        orderNumber: "ORD-1",
        stageLabel: "Balance",
        dueDate: "2026-09-03",
        overdue: false,
      }).body,
      messages.appointmentReminderSms({
        to: "+1",
        typeName: "fitting",
        whenPhrase: "tomorrow",
        time: "10:00 AM",
        locationLabel: "The studio",
      }).body,
      messages.orderReadySms({
        to: "+1",
        firstName: "Ada",
        orderNumber: "ORD-1",
      }).body,
    ];

    for (const body of bodies) {
      expect(body.startsWith("A.A Atelier: ")).toBe(true);
      expect(body.endsWith("Reply STOP to opt out.")).toBe(true);
    }
  });
});
