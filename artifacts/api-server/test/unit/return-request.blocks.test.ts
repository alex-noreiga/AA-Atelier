import { describe, it, expect } from "vitest";
import { returnRequestInput } from "@workspace/test-fixtures";
import {
  buildReturnRequestProperties,
  type ReturnRequestRow,
} from "../../src/lib/notion/return-request.blocks.js";

function row(overrides: Partial<ReturnRequestRow> = {}): ReturnRequestRow {
  return {
    orderNumber: "SHP-ABC-1234",
    emailVerified: true,
    request: returnRequestInput(),
    ...overrides,
  };
}

describe("buildReturnRequestProperties", () => {
  it("maps each field to the correct live contact-database property type", () => {
    const props = buildReturnRequestProperties(row()) as any;

    // title — names the order + kind so the inbox row reads on its own
    expect(props["Message (subject)"].title[0].text.content).toBe(
      "Return: SHP-ABC-1234",
    );
    // email property (not rich_text)
    expect(props.Email).toEqual({ email: "grace@example.com" });
    // select, defaulted to "New" — same triage stage as any inbox message
    expect(props.Stage).toEqual({ select: { name: "New" } });
  });

  it("tags the row as a return/exchange request (separates it in the inbox)", () => {
    const props = buildReturnRequestProperties(row()) as any;
    expect(props["Request type"]).toEqual({
      select: { name: "Return / exchange" },
    });
  });

  it("names an exchange in the subject when kind is exchange", () => {
    const props = buildReturnRequestProperties(
      row({ request: returnRequestInput({ kind: "exchange" }) }),
    ) as any;
    expect(props["Message (subject)"].title[0].text.content).toBe(
      "Exchange: SHP-ABC-1234",
    );
  });

  it("writes the kind, reason, items, and note into the message body", () => {
    const props = buildReturnRequestProperties(
      row({
        request: returnRequestInput({
          reason: "damaged",
          items: "Bow Fleece Soaker — Black",
          note: "One seam came apart.",
        }),
      }),
    ) as any;

    const message = props.Message.rich_text[0].text.content as string;
    expect(message).toContain("Return requested for shop order SHP-ABC-1234.");
    expect(message).toContain("Reason: Arrived damaged or defective");
    expect(message).toContain("Item(s): Bow Fleece Soaker — Black");
    expect(message).toContain("Note: One seam came apart.");
  });

  it("shows an em dash for absent optional fields", () => {
    const props = buildReturnRequestProperties(row()) as any;
    const message = props.Message.rich_text[0].text.content as string;
    expect(message).toContain("Item(s): —");
    expect(message).toContain("Note: —");
  });

  it("includes an 'Exchange for' line only for an exchange", () => {
    const exchange = buildReturnRequestProperties(
      row({
        request: returnRequestInput({
          kind: "exchange",
          exchangeFor: "size L",
        }),
      }),
    ) as any;
    expect(exchange.Message.rich_text[0].text.content).toContain(
      "Exchange for: size L",
    );

    const plainReturn = buildReturnRequestProperties(row()) as any;
    expect(plainReturn.Message.rich_text[0].text.content).not.toContain(
      "Exchange for:",
    );
  });

  it("sets the shared Item property when items are given, omits it otherwise", () => {
    const withItem = buildReturnRequestProperties(
      row({ request: returnRequestInput({ items: "Skate Soaker — Pink" }) }),
    ) as any;
    expect(withItem.Item).toEqual({
      rich_text: [{ text: { content: "Skate Soaker — Pink" } }],
    });

    const withoutItem = buildReturnRequestProperties(row()) as any;
    expect(withoutItem).not.toHaveProperty("Item");
  });

  it("flags whether the email was verified so the atelier can confirm legacy orders", () => {
    const verified = buildReturnRequestProperties(
      row({ emailVerified: true }),
    ) as any;
    expect(verified.Message.rich_text[0].text.content).toContain(
      "Email verified: yes (grace@example.com)",
    );

    const unverified = buildReturnRequestProperties(
      row({ emailVerified: false }),
    ) as any;
    expect(unverified.Message.rich_text[0].text.content).toContain(
      "Email verified: no (confirm requester) (grace@example.com)",
    );
  });

  it("links to the Client CRM record when a client page id is given", () => {
    const props = buildReturnRequestProperties(row(), "client-3") as any;
    expect(props.Client).toEqual({ relation: [{ id: "client-3" }] });
  });

  it("omits the Client relation when no client page id is given", () => {
    const props = buildReturnRequestProperties(row()) as any;
    expect(props).not.toHaveProperty("Client");
  });

  it("links the shop order via the `Shop Order` relation when a page id is given", () => {
    const props = buildReturnRequestProperties(
      row({ orderPageId: "shop-page-2" }),
    ) as any;
    expect(props["Shop Order"]).toEqual({ relation: [{ id: "shop-page-2" }] });
    expect(props).not.toHaveProperty("Order");
  });

  it("omits the `Shop Order` relation when no order page id is given", () => {
    const props = buildReturnRequestProperties(row()) as any;
    expect(props).not.toHaveProperty("Shop Order");
  });
});
