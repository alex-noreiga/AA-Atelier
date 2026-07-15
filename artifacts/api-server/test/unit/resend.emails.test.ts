import { describe, it, expect } from "vitest";
import {
  createOrderInput,
  contactInput,
  notifyInput,
  measurementChangeInput,
} from "@workspace/test-fixtures";
import {
  orderConfirmationEmail,
  contactAckEmail,
  backInStockConfirmationEmail,
  contactNotificationEmail,
  orderNotificationEmail,
  backInStockNotificationEmail,
  measurementChangeConfirmationEmail,
  measurementChangeNotificationEmail,
  shopOrderConfirmationEmail,
  shopOrderNotificationEmail,
  type ShopOrderEmailDetails,
} from "../../src/lib/resend/emails.js";

const INBOX = "orders@a3iceanddance.com";

// Shop orders have no CreateXInput domain type; the caller pre-formats the paid
// Stripe session into this struct (dollars), so the fixture is built inline.
function shopOrderDetails(
  overrides: Partial<ShopOrderEmailDetails> = {},
): ShopOrderEmailDetails {
  return {
    email: "buyer@example.com",
    customerName: "Ada Lovelace",
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
  });
});
