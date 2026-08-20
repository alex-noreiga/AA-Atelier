import { describe, it, expect } from "vitest";
import {
  createOrderInput,
  contactInput,
  notifyInput,
  measurementChangeInput,
  reviewInput,
} from "@workspace/test-fixtures";
import {
  orderConfirmationEmail,
  contactAckEmail,
  backInStockConfirmationEmail,
  backInStockAlertEmail,
  contactNotificationEmail,
  orderNotificationEmail,
  backInStockNotificationEmail,
  measurementChangeConfirmationEmail,
  measurementChangeNotificationEmail,
  reviewConfirmationEmail,
  reviewNotificationEmail,
  shopOrderConfirmationEmail,
  shopOrderNotificationEmail,
  errorAlertEmail,
  orderStageChangeEmail,
  fittingReminderEmail,
  referralWelcomeEmail,
  referralCreditEmail,
  returningSkaterRewardEmail,
  appointmentConfirmationEmail,
  appointmentRescheduledEmail,
  appointmentCancelledEmail,
  appointmentChangeNotificationEmail,
  type ShopOrderEmailDetails,
  type ErrorAlertDetails,
  type OrderStageChangeEmailDetails,
  type AppointmentEmailDetails,
} from "../../src/lib/resend/emails.js";

const INBOX = "orders@a3iceanddance.com";

// A status-change email's source isn't a CreateXInput — the caller pre-formats
// the order it read back from Notion into this struct, so the fixture is inline.
function stageChangeDetails(
  overrides: Partial<OrderStageChangeEmailDetails> = {},
): OrderStageChangeEmailDetails {
  return {
    email: "ada@example.com",
    orderName: "Ada's Competition Dress",
    orderNumber: "000002",
    stages: ["Consultation", "Sketching", "Sewing/Construction", "Delivery"],
    currentStage: "Sketching",
    ...overrides,
  };
}

// Shop orders have no CreateXInput domain type; the caller pre-formats the paid
// Stripe session into this struct (dollars), so the fixture is built inline.
function shopOrderDetails(
  overrides: Partial<ShopOrderEmailDetails> = {},
): ShopOrderEmailDetails {
  return {
    email: "buyer@example.com",
    customerName: "Ada Lovelace",
    orderNumber: "SHP-ABC-1234",
    lineItems: [
      { description: "Bow Fleece Soaker — Black", quantity: 2, amount: 44 },
    ],
    subtotal: 44,
    shipping: 8,
    tax: 1.08,
    total: 53.08,
    shippingAddress: "123 Rink Rd, Austin TX 78701, US",
    ...overrides,
  };
}

describe("orderConfirmationEmail", () => {
  it("addresses the customer and carries the order number", () => {
    const email = orderConfirmationEmail(
      createOrderInput({ fullName: "Ada Lovelace", email: "ada@example.com" }),
      "000002",
    );

    expect(email.to).toBe("ada@example.com");
    expect(email.subject).toContain("000002");
    expect(email.html).toContain("Hi Ada");
    expect(email.html).toContain("000002");
    expect(email.html).toContain("Thank you,");
    expect(email.html).toContain("A.A Atelier");
    expect(email.text).toContain("000002");
  });

  it("reads the order details back so the customer can spot a mistake", () => {
    const email = orderConfirmationEmail(
      createOrderInput({
        colors: ["Emerald"],
        description: "Ivory chiffon, long sleeves.",
        neededBy: new Date("2026-09-01T12:34:56Z") as never,
        rush: true,
        referenceImageIds: ["a", "b"],
      }),
      "000002",
    );

    expect(email.text).toContain(
      "Measurements: waist 28, chest 36, hips 38, height 65, girth 32 (inches)",
    );
    expect(email.text).toContain("Colors: Emerald");
    expect(email.text).toContain("Notes: Ivory chiffon, long sleeves.");
    expect(email.text).toContain("Reference images: 2 uploaded");
    expect(email.text).toContain("Needed by: 2026-09-01");
    expect(email.text).toContain("Rush order: Yes");
    expect(email.html).toContain("Emerald");
    // The invitation to correct it is the point of the recap.
    expect(email.text).toMatch(/reply to this email/i);
  });

  it("tells a measure-at-fitting customer so, instead of listing blanks", () => {
    const { waist, bust, hips, height, bodyGirth, ...contact } =
      createOrderInput();
    const email = orderConfirmationEmail(
      { ...contact, measurementAppointment: true },
      "000002",
    );

    expect(email.text).toContain(
      "Measurements: to be taken at a fitting or consultation appointment",
    );
    expect(email.text).not.toContain("undefined");
  });
});

describe("contactAckEmail", () => {
  it("addresses the customer by first name", () => {
    const email = contactAckEmail(
      contactInput({ name: "Grace Hopper", email: "grace@example.com" }),
    );

    expect(email.to).toBe("grace@example.com");
    expect(email.html).toContain("Hi Grace");
    expect(email.text).toContain("Hi Grace");
  });
});

describe("backInStockConfirmationEmail", () => {
  it("names the item when no size is given", () => {
    const email = backInStockConfirmationEmail(
      notifyInput({ item: "Bow Fleece Soaker — Black" }),
    );

    expect(email.to).toBe("grace@example.com");
    expect(email.subject).toContain("Bow Fleece Soaker — Black");
    expect(email.html).toContain("Bow Fleece Soaker — Black");
    expect(email.html).not.toContain("—  —");
  });

  it("appends the size band when present", () => {
    const email = backInStockConfirmationEmail(
      notifyInput({ item: "Bow Fleece Soaker — Black", size: "Adult S" }),
    );

    expect(email.html).toContain("Bow Fleece Soaker — Black — Adult S");
  });
});

describe("contactNotificationEmail", () => {
  it("goes to the atelier inbox, replies to the customer, and carries the message", () => {
    const email = contactNotificationEmail(
      contactInput({
        name: "Grace Hopper",
        email: "grace@example.com",
        message: "Do you ship to California?",
      }),
      INBOX,
    );

    expect(email.to).toBe(INBOX);
    expect(email.replyTo).toBe("grace@example.com");
    expect(email.subject).toContain("Grace Hopper");
    expect(email.text).toContain("Do you ship to California?");
    expect(email.html).toContain("grace@example.com");
  });

  it("escapes HTML in customer-provided text", () => {
    const email = contactNotificationEmail(
      contactInput({ message: "<script>alert(1)</script>" }),
      INBOX,
    );

    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
  });
});

describe("orderNotificationEmail", () => {
  it("goes to the inbox with the order number, measurements, and reply-to the customer", () => {
    const email = orderNotificationEmail(
      createOrderInput({ fullName: "Ada Lovelace", email: "ada@example.com" }),
      "000002",
      INBOX,
    );

    expect(email.to).toBe(INBOX);
    expect(email.replyTo).toBe("ada@example.com");
    expect(email.subject).toContain("000002");
    expect(email.subject).toContain("Ada Lovelace");
    expect(email.text).toContain("waist 28");
    expect(email.text).toContain("Order number: 000002");
  });

  it("omits the reference-images line when none were attached", () => {
    const email = orderNotificationEmail(createOrderInput(), "000002", INBOX);
    expect(email.text).not.toContain("Reference images");
  });

  it("notes the count when reference images were attached", () => {
    const email = orderNotificationEmail(
      createOrderInput({ referenceImageIds: ["a", "b", "c"] }),
      "000002",
      INBOX,
    );
    expect(email.text).toContain("Reference images: 3 uploaded");
  });

  it("carries every optional intake field the customer filled in", () => {
    const email = orderNotificationEmail(
      createOrderInput({
        colors: ["Emerald", "Blush"],
        colorUsage: "Emerald bodice with a blush skirt.",
        description: "Ivory chiffon, long sleeves.",
        neededBy: new Date("2026-09-01T12:34:56Z") as never,
        rush: true,
        referralCode: "AA-ABC123",
      }),
      "000002",
      INBOX,
    );

    expect(email.text).toContain("Colors: Emerald, Blush");
    expect(email.text).toContain(
      "Colors, as you'd like them used: Emerald bodice with a blush skirt.",
    );
    expect(email.text).toContain("Notes: Ivory chiffon, long sleeves.");
    expect(email.text).toContain("Needed by: 2026-09-01");
    expect(email.text).toContain("Rush order: Yes");
    expect(email.text).toContain("Referral code: AA-ABC123");
  });

  it("omits every optional field the customer left blank", () => {
    const email = orderNotificationEmail(createOrderInput(), "000002", INBOX);
    for (const label of [
      "Colors",
      "Notes",
      "Needed by",
      "Rush order",
      "Referral code",
    ]) {
      expect(email.text).not.toContain(`${label}:`);
    }
  });

  it("says measurements are coming at an appointment rather than rendering blanks", () => {
    const { waist, bust, hips, height, bodyGirth, ...contact } =
      createOrderInput();
    const email = orderNotificationEmail(
      { ...contact, measurementAppointment: true },
      "000002",
      INBOX,
    );

    expect(email.text).toContain(
      "Measurements: to be taken at a fitting or consultation appointment",
    );
    expect(email.text).not.toContain("undefined");
  });
});

describe("backInStockNotificationEmail", () => {
  it("goes to the inbox, includes item and size, and replies to the customer", () => {
    const email = backInStockNotificationEmail(
      notifyInput({
        item: "Bow Fleece Soaker — Black",
        size: "Adult S",
        email: "grace@example.com",
      }),
      INBOX,
    );

    expect(email.to).toBe(INBOX);
    expect(email.replyTo).toBe("grace@example.com");
    expect(email.subject).toContain("Bow Fleece Soaker — Black");
    expect(email.text).toContain("Adult S");
  });
});

describe("measurementChangeConfirmationEmail", () => {
  it("addresses the customer and carries the order number", () => {
    const email = measurementChangeConfirmationEmail(
      measurementChangeInput({ email: "ada@example.com" }),
      "000002",
    );

    expect(email.to).toBe("ada@example.com");
    expect(email.subject).toContain("000002");
    expect(email.html).toContain("000002");
    expect(email.html).toContain("A.A Atelier");
    expect(email.text).toContain("apply them");
  });

  it("mentions scheduling when the customer asked for an appointment", () => {
    const email = measurementChangeConfirmationEmail(
      measurementChangeInput({ measurementAppointment: true }),
      "000002",
    );

    expect(email.html).toContain("schedule");
    expect(email.text).toContain("schedule");
  });
});

describe("measurementChangeNotificationEmail", () => {
  it("goes to the inbox with the measurements, and replies to the customer", () => {
    const email = measurementChangeNotificationEmail(
      measurementChangeInput({ email: "ada@example.com", waist: 29 }),
      "000002",
      INBOX,
    );

    expect(email.to).toBe(INBOX);
    expect(email.replyTo).toBe("ada@example.com");
    expect(email.subject).toContain("000002");
    expect(email.text).toContain("Order number: 000002");
    expect(email.text).toContain("waist 29");
  });

  it("names the re-measure appointment instead of values when requested", () => {
    const email = measurementChangeNotificationEmail(
      measurementChangeInput({ measurementAppointment: true }),
      "000002",
      INBOX,
    );

    expect(email.text).toContain("Re-measurement at a fitting/consultation");
    expect(email.text).not.toContain("waist");
  });
});

describe("reviewConfirmationEmail", () => {
  it("thanks the customer and carries the order number", () => {
    const email = reviewConfirmationEmail(
      reviewInput({ email: "ada@example.com" }),
      "000002",
    );

    expect(email.to).toBe("ada@example.com");
    expect(email.subject).toContain("000002");
    expect(email.html).toContain("000002");
    expect(email.html).toContain("A.A Atelier");
    expect(email.text).toContain("Thank you");
  });
});

describe("reviewNotificationEmail", () => {
  it("goes to the inbox with the rating and review, and replies to the customer", () => {
    const email = reviewNotificationEmail(
      reviewInput({ email: "ada@example.com", rating: 5 }),
      "000002",
      INBOX,
    );

    expect(email.to).toBe(INBOX);
    expect(email.replyTo).toBe("ada@example.com");
    expect(email.subject).toContain("000002");
    expect(email.subject).toContain("5/5");
    expect(email.text).toContain("Order number: 000002");
    expect(email.text).toContain("Rating:");
    expect(email.text).toContain("stunning craftsmanship");
  });

  it("records the publish consent and the credit name when given", () => {
    const email = reviewNotificationEmail(
      reviewInput({ displayName: "Ada L.", consentToPublish: true }),
      "000002",
      INBOX,
    );

    expect(email.text).toContain("Credit as: Ada L.");
    expect(email.text).toContain("May publish: Yes");
  });

  it("marks non-consented reviews as not publishable", () => {
    const email = reviewNotificationEmail(reviewInput(), "000002", INBOX);
    expect(email.text).toContain("May publish: No");
  });
});

describe("shopOrderConfirmationEmail", () => {
  it("addresses the customer by first name and itemizes the receipt", () => {
    const email = shopOrderConfirmationEmail(shopOrderDetails());

    expect(email.to).toBe("buyer@example.com");
    expect(email.subject).toMatch(/order is confirmed/i);
    expect(email.html).toContain("Hi Ada");
    expect(email.html).toContain("2 × Bow Fleece Soaker — Black");
    // Totals reconcile: line total, shipping, tax, and grand total all appear.
    expect(email.html).toContain("$44.00");
    expect(email.html).toContain("$8.00");
    expect(email.html).toContain("$1.08");
    expect(email.html).toContain("$53.08");
    expect(email.html).toContain("123 Rink Rd");
    expect(email.text).toContain("2 × Bow Fleece Soaker — Black — $44.00");
    expect(email.text).toContain("Total: $53.08");
  });

  it("shows the order number the customer can track by", () => {
    const email = shopOrderConfirmationEmail(shopOrderDetails());

    expect(email.html).toContain("SHP-ABC-1234");
    expect(email.text).toContain("SHP-ABC-1234");
  });

  it("omits the order-number line when no number is provided", () => {
    const { orderNumber: _n, ...rest } = shopOrderDetails();
    const email = shopOrderConfirmationEmail(rest);

    expect(email.html).not.toContain("Your order number");
    expect(email.text).not.toContain("Your order number");
  });

  it("omits shipping and tax lines when they are zero", () => {
    const { shippingAddress: _addr, ...rest } = shopOrderDetails();
    const email = shopOrderConfirmationEmail({
      ...rest,
      shipping: 0,
      tax: 0,
      total: 44,
    });

    expect(email.html).not.toContain("Shipping");
    expect(email.html).not.toContain("Tax");
    expect(email.text).not.toContain("Shipping:");
    expect(email.text).not.toContain("Tax:");
    expect(email.html).toContain("$44.00");
  });

  it("falls back to a neutral greeting when no name is provided", () => {
    const { customerName: _name, ...rest } = shopOrderDetails();
    const email = shopOrderConfirmationEmail(rest);

    expect(email.html).toContain("Hi there");
  });

  it("escapes HTML in a line-item description", () => {
    const email = shopOrderConfirmationEmail(
      shopOrderDetails({
        lineItems: [
          { description: "<script>alert(1)</script>", quantity: 1, amount: 10 },
        ],
      }),
    );

    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
  });
});

describe("shopOrderNotificationEmail", () => {
  it("goes to the atelier inbox, replies to the customer, and lists items + total", () => {
    const email = shopOrderNotificationEmail(shopOrderDetails(), INBOX);

    expect(email.to).toBe(INBOX);
    expect(email.replyTo).toBe("buyer@example.com");
    expect(email.subject).toContain("Ada Lovelace");
    expect(email.subject).toContain("$53.08");
    expect(email.text).toContain("Bow Fleece Soaker — Black");
    expect(email.text).toContain("Total: $53.08");
    expect(email.text).toContain("Order number: SHP-ABC-1234");
  });
});

describe("errorAlertEmail", () => {
  const ALERT_TO = "alexandra@a3iceanddance.com";

  function alertDetails(
    overrides: Partial<ErrorAlertDetails> = {},
  ): ErrorAlertDetails {
    return {
      message: "Unhandled error",
      errorType: "Error",
      errorMessage: "Notion 500",
      method: "POST",
      path: "/api/orders",
      requestId: "req-123",
      statusCode: 500,
      environment: "production",
      timestamp: "2026-07-16T12:00:00.000Z",
      ...overrides,
    };
  }

  it("goes to the alert inbox with the message in the subject and body", () => {
    const email = errorAlertEmail(alertDetails(), ALERT_TO);

    expect(email.to).toBe(ALERT_TO);
    expect(email.subject).toContain("Error: Unhandled error");
    expect(email.html).toContain("A.A Atelier");
    // No customer to reply to.
    expect(email.replyTo).toBeUndefined();
    // Carries the diagnostic fields.
    expect(email.text).toContain("Notion 500");
    expect(email.text).toContain("POST /api/orders");
    expect(email.text).toContain("req-123");
    expect(email.text).toContain("production");
  });

  it("renders and escapes the stack trace when present", () => {
    const email = errorAlertEmail(
      alertDetails({ stack: "Error: <b>boom</b>\n  at handler" }),
      ALERT_TO,
    );

    expect(email.text).toContain("Stack:");
    expect(email.text).toContain("at handler");
    // HTML-escaped so a stack can't inject markup into the alert.
    expect(email.html).not.toContain("<b>boom</b>");
    expect(email.html).toContain("&lt;b&gt;boom&lt;/b&gt;");
  });

  it("omits optional fields that aren't provided", () => {
    const email = errorAlertEmail(
      {
        message: "Failed to record completed checkout session",
        timestamp: "t",
      },
      ALERT_TO,
    );

    expect(email.subject).toContain(
      "Failed to record completed checkout session",
    );
    expect(email.text).not.toContain("Request:");
    expect(email.text).not.toContain("Status:");
    expect(email.text).not.toContain("Stack:");
  });
});

describe("orderStageChangeEmail", () => {
  it("uses the good-news subject + heading and leads with the stage flavor", () => {
    const email = orderStageChangeEmail(
      stageChangeDetails({
        email: "ada@example.com",
        currentStage: "Sketching",
      }),
    );

    expect(email.to).toBe("ada@example.com");
    expect(email.subject).toBe(
      "Good news! Your custom piece has progressed to a new stage in our atelier.",
    );
    expect(email.html).toContain("Good news!");
    // Body leads with "We're now <flavor>" (HTML uses a typographic apostrophe).
    expect(email.html).toContain(
      "re now translating your ideas into the first designs",
    );
    expect(email.text).toContain(
      "We're now translating your ideas into the first designs",
    );
    expect(email.html).toContain("000002");
    expect(email.html).toContain("A.A Atelier");
  });

  it("renders the whole pipeline, marking done/current/upcoming stages", () => {
    const email = orderStageChangeEmail(
      stageChangeDetails({
        stages: [
          "Consultation",
          "Sketching",
          "Sewing/Construction",
          "Delivery",
        ],
        currentStage: "Sketching",
      }),
    );

    // Every stage appears in the graphic.
    for (const stage of [
      "Consultation",
      "Sketching",
      "Sewing/Construction",
      "Delivery",
    ]) {
      expect(email.html).toContain(stage);
    }
    // The current stage is flagged in progress (HTML) and marked in plaintext.
    expect(email.html).toContain("in progress");
    expect(email.text).toContain("[x] Consultation");
    expect(email.text).toContain("[>] Sketching  <- in progress");
    expect(email.text).toContain("[ ] Delivery");
  });

  it("shows the active stage's flavor after \"We're now\"", () => {
    const email = orderStageChangeEmail(
      stageChangeDetails({ currentStage: "Cutting/Pinning" }),
    );
    expect(email.html).toContain("cutting the fabric to pattern");
    expect(email.text).toContain("We're now cutting the fabric to pattern");
  });

  it("falls back to a generic flavor for an unknown stage", () => {
    const email = orderStageChangeEmail(
      stageChangeDetails({
        stages: ["Consultation", "Bespoke Beading"],
        currentStage: "Bespoke Beading",
      }),
    );
    expect(email.html).toContain("carefully working on this stage");
    expect(email.text).toContain("We're now carefully working on this stage");
  });

  it("includes the estimated completion date when provided, omits it otherwise", () => {
    const withDate = orderStageChangeEmail(
      stageChangeDetails({ estimatedCompletion: "2026-09-01" }),
    );
    expect(withDate.html).toContain("Estimated completion");
    expect(withDate.html).toContain("2026-09-01");
    expect(withDate.text).toContain("Estimated completion: 2026-09-01");

    const withoutDate = orderStageChangeEmail(stageChangeDetails());
    expect(withoutDate.html).not.toContain("Estimated completion");
  });

  it("includes a direct tracking link only when a trackingUrl is provided", () => {
    const withLink = orderStageChangeEmail(
      stageChangeDetails({
        trackingUrl: "https://a3iceanddance.com/track?orderNumber=000002",
      }),
    );
    expect(withLink.html).toContain(
      "https://a3iceanddance.com/track?orderNumber=000002",
    );
    expect(withLink.html).toContain("View your order");
    expect(withLink.text).toContain(
      "https://a3iceanddance.com/track?orderNumber=000002",
    );

    const withoutLink = orderStageChangeEmail(stageChangeDetails());
    expect(withoutLink.html).not.toContain("tracking page");
  });

  it("HTML-escapes dynamic values from Notion (stage names, order name)", () => {
    const email = orderStageChangeEmail(
      stageChangeDetails({
        stages: ["Consultation", "<b>Fitting</b>"],
        currentStage: "<b>Fitting</b>",
        orderNumber: "A&B-1",
      }),
    );
    expect(email.html).toContain("&lt;b&gt;Fitting&lt;/b&gt;");
    expect(email.html).not.toContain("<b>Fitting</b>");
    expect(email.html).toContain("A&amp;B-1");
  });
});

describe("fittingReminderEmail", () => {
  it("uses the fitting subject + heading and carries the order number", () => {
    const email = fittingReminderEmail({
      email: "ada@example.com",
      orderNumber: "000002",
    });

    expect(email.to).toBe("ada@example.com");
    expect(email.subject).toBe("Let's schedule your fitting (000002)");
    expect(email.html).toContain("Time to book your fitting");
    expect(email.html).toContain("000002");
    expect(email.text).toContain("Order number: 000002");
    expect(email.html).toContain("A.A Atelier");
  });

  it("mentions the target date when provided, omits it otherwise", () => {
    const withDate = fittingReminderEmail({
      email: "ada@example.com",
      orderNumber: "000002",
      targetDate: "2026-08-15",
    });
    // Rendered as a friendly, timezone-safe label (UTC), not the raw ISO string.
    expect(withDate.html).toContain("August 15, 2026");
    expect(withDate.text).toContain("August 15, 2026");
    expect(withDate.html).not.toContain("2026-08-15");

    const withoutDate = fittingReminderEmail({
      email: "ada@example.com",
      orderNumber: "000002",
    });
    expect(withoutDate.html).not.toContain("2026-08-15");
    expect(withoutDate.html).toContain("approaching its fitting stage");
  });

  it("includes the booking CTA only when a bookingUrl is provided", () => {
    const withLink = fittingReminderEmail({
      email: "ada@example.com",
      orderNumber: "000002",
      bookingUrl: "https://a3iceanddance.com/appointments?type=fitting",
    });
    expect(withLink.html).toContain(
      "https://a3iceanddance.com/appointments?type=fitting",
    );
    expect(withLink.html).toContain("Book your fitting");
    expect(withLink.text).toContain(
      "Book your fitting: https://a3iceanddance.com/appointments?type=fitting",
    );

    const withoutLink = fittingReminderEmail({
      email: "ada@example.com",
      orderNumber: "000002",
    });
    expect(withoutLink.html).not.toContain("Book your fitting");
  });

  it("HTML-escapes dynamic values from Notion (order number, target date)", () => {
    const email = fittingReminderEmail({
      email: "ada@example.com",
      orderNumber: "A&B-1",
      targetDate: "<b>soon</b>",
    });
    expect(email.html).toContain("A&amp;B-1");
    expect(email.html).toContain("&lt;b&gt;soon&lt;/b&gt;");
    expect(email.html).not.toContain("<b>soon</b>");
  });
});

const appointmentDetails = (
  overrides: Partial<AppointmentEmailDetails> = {},
): AppointmentEmailDetails => ({
  customerName: "Ada Lovelace",
  email: "ada@example.com",
  typeName: "Consultation",
  staff: "Alayna",
  locationLabel: "In person",
  when: "Monday, July 20 at 10:00 AM EDT",
  confirmationCode: "APT-XYZ",
  ...overrides,
});

describe("referral & returning-skater reward emails", () => {
  it("referralWelcomeEmail carries the welcome code + percent, to the new skater", () => {
    const email = referralWelcomeEmail({
      email: "new@example.com",
      code: "AA-WELCOME-ABC123",
      percent: 10,
    });
    expect(email.to).toBe("new@example.com");
    expect(email.subject).toBe("A welcome gift for your first order");
    expect(email.html).toContain("AA-WELCOME-ABC123");
    expect(email.html).toContain("10% off");
    expect(email.text).toContain("AA-WELCOME-ABC123");
    expect(email.html).toContain("A.A Atelier");
  });

  it("referralCreditEmail carries the credit code + amount, to the referrer", () => {
    const email = referralCreditEmail({
      email: "referrer@example.com",
      code: "AA-CREDIT-XYZ789",
      amount: 40,
    });
    expect(email.to).toBe("referrer@example.com");
    expect(email.subject).toBe("You've earned a referral credit");
    expect(email.html).toContain("AA-CREDIT-XYZ789");
    expect(email.html).toContain("$40 in credit");
    expect(email.text).toContain("AA-CREDIT-XYZ789");
  });

  it("returningSkaterRewardEmail carries the standing code + percent", () => {
    const email = returningSkaterRewardEmail({
      email: "ada@example.com",
      code: "AA-AGAIN-QQ1122",
      percent: 15,
    });
    expect(email.to).toBe("ada@example.com");
    expect(email.subject).toBe("A little thank-you for coming back");
    expect(email.html).toContain("AA-AGAIN-QQ1122");
    expect(email.html).toContain("15% off");
    expect(email.text).toContain("AA-AGAIN-QQ1122");
  });
});

describe("appointmentConfirmationEmail", () => {
  it("links to the manage page when a manageUrl is present", () => {
    const email = appointmentConfirmationEmail(
      appointmentDetails({
        manageUrl: "https://example.test/appointments/manage?token=abc",
      }),
    );
    expect(email.html).toContain(
      "https://example.test/appointments/manage?token=abc",
    );
    expect(email.html).toContain("Reschedule or cancel");
    expect(email.text).toContain(
      "https://example.test/appointments/manage?token=abc",
    );
    // The old "reply to this email" fallback is gone when we have a link.
    expect(email.html).not.toContain("reply to this email");
  });

  it("falls back to 'reply to us' copy when no manageUrl is configured", () => {
    const email = appointmentConfirmationEmail(appointmentDetails());
    expect(email.html).toContain("reply to this email");
    expect(email.html).not.toContain("/appointments/manage");
  });
});

describe("appointmentRescheduledEmail", () => {
  it("announces the new time and keeps the confirmation code", () => {
    const email = appointmentRescheduledEmail(
      appointmentDetails({
        when: "Tuesday, July 21 at 3:00 PM EDT",
        manageUrl: "https://example.test/appointments/manage?token=abc",
      }),
    );
    expect(email.subject).toMatch(/rescheduled/i);
    expect(email.html).toContain("Tuesday, July 21 at 3:00 PM EDT");
    expect(email.html).toContain("APT-XYZ");
    expect(email.html).toContain(
      "https://example.test/appointments/manage?token=abc",
    );
  });
});

describe("appointmentCancelledEmail", () => {
  it("confirms the cancellation and invites re-booking", () => {
    const email = appointmentCancelledEmail(appointmentDetails());
    expect(email.subject).toMatch(/cancelled/i);
    expect(email.html).toContain("cancelled");
    expect(email.to).toBe("ada@example.com");
  });
});

describe("appointmentChangeNotificationEmail", () => {
  it("labels the atelier notice by action and replies to the customer", () => {
    const rescheduled = appointmentChangeNotificationEmail(
      appointmentDetails(),
      INBOX,
      "rescheduled",
    );
    expect(rescheduled.to).toBe(INBOX);
    expect(rescheduled.replyTo).toBe("ada@example.com");
    expect(rescheduled.subject).toMatch(/rescheduled/i);

    const cancelled = appointmentChangeNotificationEmail(
      appointmentDetails(),
      INBOX,
      "cancelled",
    );
    expect(cancelled.subject).toMatch(/cancelled/i);
  });
});

describe("backInStockAlertEmail", () => {
  it("names the piece in the subject and body", () => {
    const email = backInStockAlertEmail({
      email: "grace@example.com",
      item: "Bow Fleece Soaker — Black",
    });

    expect(email.to).toBe("grace@example.com");
    expect(email.subject).toBe("Back in stock: Bow Fleece Soaker — Black");
    expect(email.html).toContain("Bow Fleece Soaker — Black");
    expect(email.text).toContain("Bow Fleece Soaker — Black");
  });

  it("appends the size the customer asked about, like the request confirmation", () => {
    const email = backInStockAlertEmail({
      email: "grace@example.com",
      item: "Bow Fleece Soaker — Black",
      size: "M",
    });

    expect(email.subject).toBe("Back in stock: Bow Fleece Soaker — Black — M");
  });

  it("renders the shop button when a product URL is supplied", () => {
    const email = backInStockAlertEmail({
      email: "grace@example.com",
      item: "Soaker",
      productUrl: "https://a3iceanddance.com/shop/inv-1",
    });

    expect(email.html).toContain("View it in the shop");
    expect(email.html).toContain("https://a3iceanddance.com/shop/inv-1");
    expect(email.text).toContain("https://a3iceanddance.com/shop/inv-1");
  });

  it("omits the button entirely when there is no URL", () => {
    const email = backInStockAlertEmail({
      email: "grace@example.com",
      item: "Soaker",
    });

    expect(email.html).not.toContain("View it in the shop");
    expect(email.text).not.toContain("View it in the shop");
  });

  it("escapes an item name carrying markup", () => {
    const email = backInStockAlertEmail({
      email: "grace@example.com",
      item: "<b>Soaker</b>",
    });

    expect(email.html).toContain("&lt;b&gt;Soaker&lt;/b&gt;");
  });
});
