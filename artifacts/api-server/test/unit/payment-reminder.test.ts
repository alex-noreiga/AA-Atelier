import { describe, it, expect, afterEach } from "vitest";
import {
  paymentReminderLeadDays,
  isPaymentOverdue,
} from "../../src/services/payment-reminder.js";

describe("paymentReminderLeadDays", () => {
  afterEach(() => {
    delete process.env.PAYMENT_REMINDER_LEAD_DAYS;
  });

  it("defaults to 7 when unset", () => {
    expect(paymentReminderLeadDays()).toBe(7);
  });

  it("reads a positive numeric override", () => {
    process.env.PAYMENT_REMINDER_LEAD_DAYS = "14";
    expect(paymentReminderLeadDays()).toBe(14);
  });

  it("falls back to the default for a non-numeric or non-positive value", () => {
    process.env.PAYMENT_REMINDER_LEAD_DAYS = "soon";
    expect(paymentReminderLeadDays()).toBe(7);
    process.env.PAYMENT_REMINDER_LEAD_DAYS = "0";
    expect(paymentReminderLeadDays()).toBe(7);
    process.env.PAYMENT_REMINDER_LEAD_DAYS = "-3";
    expect(paymentReminderLeadDays()).toBe(7);
  });
});

describe("isPaymentOverdue", () => {
  it("is true only when the due date is strictly before today", () => {
    expect(isPaymentOverdue("2026-08-01", "2026-08-04")).toBe(true);
    expect(isPaymentOverdue("2026-08-04", "2026-08-04")).toBe(false); // due today
    expect(isPaymentOverdue("2026-08-10", "2026-08-04")).toBe(false); // upcoming
  });
});
