import { describe, it, expect } from "vitest";
import {
  createOrderLine,
  orderLinesConfigured,
} from "../../src/lib/notion/order-lines.repository.js";
import {
  makeFakeClient,
  jsonResponse,
  errorResponse,
} from "../support/fake-notion.js";
import {
  ORDER_LINE_ITEM_PROPERTY,
  ORDER_LINE_ORDER_PROPERTY,
  ORDER_LINE_QTY_PROPERTY,
} from "../../src/lib/notion/order-lines.blocks.js";

function lineInput() {
  return {
    orderPageId: "order-page",
    itemPageId: "inventory-page",
    name: "Bow Fleece Soaker — Adult M",
    quantity: 2,
    unitPrice: 22,
    size: "Adult M",
  };
}

describe("orderLinesConfigured", () => {
  it("is false when the order-lines database id is unset", () => {
    expect(
      orderLinesConfigured(makeFakeClient(() => jsonResponse({}), "")),
    ).toBe(false);
  });

  it("is true when a database id is configured", () => {
    expect(orderLinesConfigured(makeFakeClient(() => jsonResponse({})))).toBe(
      true,
    );
  });
});

describe("createOrderLine", () => {
  it("throws when the order-lines database id is not configured", async () => {
    const client = makeFakeClient(() => jsonResponse({}), "");
    await expect(createOrderLine(lineInput(), client)).rejects.toThrow(
      /NOTION_ORDER_LINES_DATABASE_ID is not configured/,
    );
  });

  it("POSTs a page parented to the order-lines database with both relations", async () => {
    const client = makeFakeClient((path) => {
      if (path === "/v1/pages") return jsonResponse({ id: "line-page" }, 200);
      throw new Error(`unexpected path ${path}`);
    });

    await createOrderLine(lineInput(), client);

    expect(client.calls).toHaveLength(1);
    const call = client.calls[0];
    expect(call.path).toBe("/v1/pages");
    expect(call.init?.method).toBe("POST");
    const body = JSON.parse(call.init!.body as string);
    expect(body.parent).toEqual({ database_id: "test-db-id" });
    expect(body.properties[ORDER_LINE_ORDER_PROPERTY]).toEqual({
      relation: [{ id: "order-page" }],
    });
    expect(body.properties[ORDER_LINE_ITEM_PROPERTY]).toEqual({
      relation: [{ id: "inventory-page" }],
    });
    expect(body.properties[ORDER_LINE_QTY_PROPERTY]).toEqual({ number: 2 });
  });

  it("throws with the status and Notion error text on a non-ok response", async () => {
    const client = makeFakeClient(() =>
      errorResponse(400, "validation_error: bad property"),
    );
    await expect(createOrderLine(lineInput(), client)).rejects.toThrow(
      /Notion order line creation failed with status 400/,
    );
  });
});
