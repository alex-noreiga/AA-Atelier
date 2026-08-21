import { describe, it, expect } from "vitest";
import {
  extractOrderNumber,
  extractStudioRequest,
  extractStudioRequests,
  isNewsletterRow,
  requestAction,
  requestKind,
  requestState,
  type NotionRequestPage,
} from "../../src/lib/notion/requests.schema.js";
import { contactRequestPage } from "../support/fake-notion.js";

const page = (opts: Parameters<typeof contactRequestPage>[0] = {}) =>
  contactRequestPage(opts) as NotionRequestPage;

// Both derivations point the same way on purpose: a row the app doesn't
// recognize appears in the queue asking to be looked at, rather than being
// filtered out of it. A queue that silently drops work is worse than one that
// shows something odd.
describe("requestKind", () => {
  it("maps each Request type the app writes", () => {
    expect(requestKind(page({ requestType: "Inquiry" }))).toBe("inquiry");
    expect(requestKind(page({ requestType: "Back in stock" }))).toBe(
      "back-in-stock",
    );
    expect(requestKind(page({ requestType: "Measurement update" }))).toBe(
      "measurement",
    );
    expect(requestKind(page({ requestType: "Cancellation" }))).toBe(
      "cancellation",
    );
    expect(requestKind(page({ requestType: "Return / exchange" }))).toBe(
      "return",
    );
  });

  it("reads an unrecognized or blank type as `other` rather than dropping it", () => {
    expect(requestKind(page({ requestType: "Alteration quote" }))).toBe(
      "other",
    );
    expect(requestKind(page({ requestType: null }))).toBe("other");
    expect(requestKind({ id: "x", properties: {} })).toBe("other");
  });
});

describe("requestState", () => {
  it("recognizes the two stages beyond the capture default", () => {
    expect(requestState(page({ stage: "Replied" }))).toBe("replied");
    expect(requestState(page({ stage: "Closed" }))).toBe("closed");
  });

  it("treats anything else — including no stage at all — as still open", () => {
    expect(requestState(page({ stage: "New" }))).toBe("new");
    expect(requestState(page({ stage: null }))).toBe("new");
    expect(requestState(page({ stage: "Waiting on customer" }))).toBe("new");
    expect(requestState({ id: "x", properties: {} })).toBe("new");
  });

  it("is case-sensitive on the closed option, so a rename reopens rather than hides", () => {
    expect(requestState(page({ stage: "closed" }))).toBe("new");
  });
});

describe("isNewsletterRow", () => {
  it("recognizes an opt-in whatever its casing", () => {
    expect(isNewsletterRow(page({ requestType: "Newsletter" }))).toBe(true);
    expect(isNewsletterRow(page({ requestType: "newsletter" }))).toBe(true);
  });

  it("leaves every actual request alone", () => {
    expect(isNewsletterRow(page({ requestType: "Inquiry" }))).toBe(false);
    expect(isNewsletterRow(page({ requestType: null }))).toBe(false);
  });
});

// The order number is what the queue exists to carry: it is the value the
// atelier used to re-type into a refund tool by hand.
describe("extractOrderNumber", () => {
  it("reads it out of the writer's own title", () => {
    expect(extractOrderNumber("Cancellation: ORD-000002", "")).toBe(
      "ORD-000002",
    );
    expect(extractOrderNumber("Return: SHP-1A2B3C", "")).toBe("SHP-1A2B3C");
  });

  it("falls back to the message body when the title was rewritten", () => {
    expect(
      extractOrderNumber(
        "Angry customer — please call",
        "Return requested for shop order SHP-LEGACY-0007.\n\nReason: Wrong size",
      ),
    ).toBe("SHP-LEGACY-0007");
  });

  it("prefers the title, which is the writer's own summary", () => {
    expect(
      extractOrderNumber(
        "Cancellation: ORD-000002",
        "Customer also mentioned ORD-000009.",
      ),
    ).toBe("ORD-000002");
  });

  it("returns nothing when there is no order number to be had", () => {
    expect(extractOrderNumber("Ada – Website inquiry", "Hello!")).toBe("");
    // A bare number is not enough: a refund runs against whatever this returns.
    expect(extractOrderNumber("Cancellation: 000002", "")).toBe("");
  });
});

describe("requestAction", () => {
  it("hands each actionable kind to its tool with the argument it needs", () => {
    expect(
      requestAction("cancellation", { orderNumber: "ORD-000002" }),
    ).toEqual({
      tool: "cancellation-refund",
      orderNumber: "ORD-000002",
    });
    expect(requestAction("return", { orderNumber: "SHP-1A2B" })).toEqual({
      tool: "return-refund",
      orderNumber: "SHP-1A2B",
    });
    expect(requestAction("back-in-stock", { item: "Aurora Dress" })).toEqual({
      tool: "restock-alert",
      item: "Aurora Dress",
    });
  });

  it("offers nothing for the kinds the atelier answers by hand", () => {
    expect(
      requestAction("measurement", { orderNumber: "ORD-000002" }),
    ).toBeUndefined();
    expect(requestAction("inquiry", {})).toBeUndefined();
    expect(
      requestAction("other", { orderNumber: "ORD-000002" }),
    ).toBeUndefined();
  });

  // Withheld rather than blank: the tools run against whatever is in the field.
  it("offers nothing when the argument couldn't be recovered", () => {
    expect(requestAction("cancellation", {})).toBeUndefined();
    expect(requestAction("back-in-stock", { item: "" })).toBeUndefined();
  });
});

describe("extractStudioRequest", () => {
  it("maps a cancellation, carrying its order number to the refund tool", () => {
    expect(extractStudioRequest(page({ id: "req-1" }))).toEqual({
      id: "req-1",
      kind: "cancellation",
      rawType: "Cancellation",
      subject: "Cancellation: ORD-000002",
      email: "skater@example.com",
      message:
        "Cancellation requested for custom order ORD-000002.\n\nReason: —",
      orderNumber: "ORD-000002",
      state: "new",
      rawStage: "New",
      submittedAt: "2026-08-01T12:00:00.000Z",
      notionUrl: "https://notion.so/request-page",
      action: { tool: "cancellation-refund", orderNumber: "ORD-000002" },
    });
  });

  it("maps a back-in-stock request to the restock sweep, by item", () => {
    const request = extractStudioRequest(
      page({
        requestType: "Back in stock",
        subject: "Back in stock: Aurora Dress — Youth 12",
        message: "",
        item: "Aurora Dress",
        size: "Youth 12",
      }),
    );

    expect(request.kind).toBe("back-in-stock");
    expect(request.item).toBe("Aurora Dress");
    expect(request.size).toBe("Youth 12");
    expect(request.action).toEqual({
      tool: "restock-alert",
      item: "Aurora Dress",
    });
    // It concerns no order, so nothing is parsed out of the title.
    expect(request.orderNumber).toBeUndefined();
  });

  it("carries an inquiry's name and phone, and offers no tool", () => {
    const request = extractStudioRequest(
      page({
        requestType: "Inquiry",
        subject: "Ada – Website inquiry",
        customerName: "Ada Lovelace",
        phone: "+15551234567",
        message: "Do you make practice dresses?",
      }),
    );

    expect(request.kind).toBe("inquiry");
    expect(request.customerName).toBe("Ada Lovelace");
    expect(request.phone).toBe("+15551234567");
    expect(request.action).toBeUndefined();
  });

  // An order number quoted in an inquiry is not a request against that order,
  // and offering a refund button on one would be a serious way to be wrong.
  it("never parses an order number out of a kind that concerns no order", () => {
    const request = extractStudioRequest(
      page({
        requestType: "Inquiry",
        subject: "Question about ORD-000002",
        message: "Is ORD-000002 on track?",
      }),
    );

    expect(request.orderNumber).toBeUndefined();
    expect(request.action).toBeUndefined();
  });

  it("names an untitled row rather than rendering a blank card", () => {
    expect(extractStudioRequest(page({ subject: "" })).subject).toBe(
      "Cancellation",
    );
    expect(
      extractStudioRequest(page({ subject: "", requestType: null })).subject,
    ).toBe("Untitled request");
  });

  it("omits every field the row doesn't carry", () => {
    expect(extractStudioRequest({ id: "bare", properties: {} })).toEqual({
      id: "bare",
      kind: "other",
      subject: "Untitled request",
      state: "new",
    });
  });
});

describe("extractStudioRequests", () => {
  it("drops the newsletter opt-ins that share the database", () => {
    const records = extractStudioRequests([
      page({ id: "keep", requestType: "Cancellation" }),
      page({ id: "drop", requestType: "Newsletter" }),
      page({ id: "keep-2", requestType: "Inquiry" }),
    ]);

    expect(records.map((r) => r.id)).toEqual(["keep", "keep-2"]);
  });
});
