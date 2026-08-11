import { describe, it, expect } from "vitest";
import {
  buildCancellationProperties,
  type CancellationRow,
} from "../../src/lib/notion/cancellation.blocks.js";

function row(overrides: Partial<CancellationRow> = {}): CancellationRow {
  return {
    orderNumber: "ORD-1",
    orderType: "custom",
    emailVerified: true,
    email: "ada@example.com",
    reason: "My competition schedule changed.",
    ...overrides,
  };
}

describe("buildCancellationProperties", () => {
  it("maps each field to the correct live contact-database property type", () => {
    const props = buildCancellationProperties(row()) as any;

    expect(props["Message (subject)"].title[0].text.content).toBe(
      "Cancellation: ORD-1",
    );
    expect(props.Email).toEqual({ email: "ada@example.com" });
    expect(props.Stage).toEqual({ select: { name: "New" } });
  });

  it("tags the row as a cancellation request (separates it in the inbox)", () => {
    const props = buildCancellationProperties(row()) as any;
    expect(props["Request type"]).toEqual({ select: { name: "Cancellation" } });
  });

  it("names the order type and reason in the message body", () => {
    const custom = buildCancellationProperties(row()) as any;
    const message = custom.Message.rich_text[0].text.content as string;
    expect(message).toContain("custom order ORD-1");
    expect(message).toContain("Reason: My competition schedule changed.");

    const shop = buildCancellationProperties(
      row({ orderType: "shop", orderNumber: "SHP-1" }),
    ) as any;
    expect(shop.Message.rich_text[0].text.content).toContain(
      "shop order SHP-1",
    );
  });

  it("shows an em dash when no reason is provided", () => {
    const props = buildCancellationProperties(
      row({ reason: undefined }),
    ) as any;
    expect(props.Message.rich_text[0].text.content).toContain("Reason: —");
  });

  it("flags whether the email was verified so the atelier can confirm legacy orders", () => {
    const verified = buildCancellationProperties(
      row({ emailVerified: true }),
    ) as any;
    expect(verified.Message.rich_text[0].text.content).toContain(
      "Email verified: yes (ada@example.com)",
    );

    const unverified = buildCancellationProperties(
      row({ emailVerified: false }),
    ) as any;
    expect(unverified.Message.rich_text[0].text.content).toContain(
      "Email verified: no (confirm requester) (ada@example.com)",
    );
  });

  it("links to the Client CRM record when a client page id is given", () => {
    const props = buildCancellationProperties(row(), "client-3") as any;
    expect(props.Client).toEqual({ relation: [{ id: "client-3" }] });
  });

  it("omits the Client relation when no client page id is given", () => {
    const props = buildCancellationProperties(row()) as any;
    expect(props).not.toHaveProperty("Client");
  });

  it("links a custom order via `Order` and a shop order via `Shop Order`", () => {
    const custom = buildCancellationProperties(
      row({ orderType: "custom", orderPageId: "order-page-1" }),
    ) as any;
    expect(custom.Order).toEqual({ relation: [{ id: "order-page-1" }] });
    expect(custom).not.toHaveProperty("Shop Order");

    const shop = buildCancellationProperties(
      row({ orderType: "shop", orderPageId: "shop-page-1" }),
    ) as any;
    expect(shop["Shop Order"]).toEqual({ relation: [{ id: "shop-page-1" }] });
    expect(shop).not.toHaveProperty("Order");
  });

  it("omits the order relation when no order page id is given", () => {
    const props = buildCancellationProperties(row()) as any;
    expect(props).not.toHaveProperty("Order");
    expect(props).not.toHaveProperty("Shop Order");
  });
});
