import { describe, it, expect } from "vitest";
import {
  makeFakeClient,
  jsonResponse,
  errorResponse,
  invoicePage,
  lineItemPage,
} from "../support/fake-notion.js";
import {
  findInvoice,
  listInvoiceLineItems,
  markBalancePaid,
} from "../../src/lib/notion/invoice.repository.js";

const isQuery = (path: string) => path.endsWith("/query");

describe("findInvoice", () => {
  it("fetches the invoice page and maps it", async () => {
    const client = makeFakeClient((path) => {
      if (path === "/v1/pages/inv-1") {
        return jsonResponse(
          invoicePage({ id: "inv-1", invoiceId: "Toothless", ready: true }),
        );
      }
      throw new Error(`unexpected ${path}`);
    });

    const invoice = await findInvoice("inv-1", client);
    expect(invoice).toMatchObject({
      pageId: "inv-1",
      invoiceId: "Toothless",
      ready: true,
      balancePaid: false,
    });
  });

  it("returns null when the invoice page is gone (404)", async () => {
    const client = makeFakeClient(() => errorResponse(404, "not found"));
    expect(await findInvoice("inv-x", client)).toBeNull();
  });

  it("throws on other non-ok responses", async () => {
    const client = makeFakeClient(() => errorResponse(500));
    await expect(findInvoice("inv-1", client)).rejects.toThrow(/status 500/);
  });
});

describe("listInvoiceLineItems", () => {
  it("filters by the Invoice relation and pages through all results", async () => {
    const client = makeFakeClient((path, init) => {
      if (!isQuery(path)) throw new Error(`unexpected ${path}`);
      const body = JSON.parse(init!.body as string);
      if (!body.start_cursor) {
        return jsonResponse({
          results: [
            lineItemPage({ name: "Main fabric", type: "Material", total: 40 }),
          ],
          has_more: true,
          next_cursor: "c1",
        });
      }
      return jsonResponse({
        results: [lineItemPage({ name: "Labor", type: "Labor", total: 120 })],
        has_more: false,
        next_cursor: null,
      });
    });

    const items = await listInvoiceLineItems("inv-1", client);

    expect(items).toEqual([
      { name: "Main fabric", type: "Material", amount: 40 },
      { name: "Labor", type: "Labor", amount: 120 },
    ]);
    // First page filters on the Invoice relation; second page carries the cursor.
    const firstBody = JSON.parse(client.calls[0].init!.body as string);
    expect(firstBody.filter).toEqual({
      property: "Invoice",
      relation: { contains: "inv-1" },
    });
    expect(client.calls).toHaveLength(2);
    expect(JSON.parse(client.calls[1].init!.body as string).start_cursor).toBe(
      "c1",
    );
  });

  it("throws when a query response is not ok", async () => {
    const client = makeFakeClient(() => errorResponse(500));
    await expect(listInvoiceLineItems("inv-1", client)).rejects.toThrow(
      /Notion query failed with status 500/,
    );
  });
});

describe("markBalancePaid", () => {
  it("PATCHes the order and the invoice with the paid flags + session id", async () => {
    const ordersClient = makeFakeClient((path) => {
      if (path === "/v1/pages/order-1") return jsonResponse({ id: "order-1" });
      throw new Error(`unexpected orders ${path}`);
    });
    const invoicesClient = makeFakeClient((path) => {
      if (path === "/v1/pages/inv-1") return jsonResponse({ id: "inv-1" });
      throw new Error(`unexpected invoices ${path}`);
    });

    await markBalancePaid(
      "order-1",
      "inv-1",
      "cs_test_9",
      ordersClient,
      invoicesClient,
    );

    const orderBody = JSON.parse(ordersClient.calls[0].init!.body as string);
    expect(ordersClient.calls[0].init?.method).toBe("PATCH");
    expect(orderBody.properties["Invoice Paid"]).toEqual({ checkbox: true });
    expect(
      orderBody.properties["Invoice Session Id"].rich_text[0].text.content,
    ).toBe("cs_test_9");

    const invoiceBody = JSON.parse(
      invoicesClient.calls[0].init!.body as string,
    );
    expect(invoiceBody.properties["Balance Paid"]).toEqual({ checkbox: true });
    expect(
      invoiceBody.properties["Balance Payment Session Id"].rich_text[0].text
        .content,
    ).toBe("cs_test_9");
  });

  it("throws when the order update fails", async () => {
    const ordersClient = makeFakeClient(() => errorResponse(400, "bad"));
    const invoicesClient = makeFakeClient(() => jsonResponse({ id: "inv-1" }));
    await expect(
      markBalancePaid("order-1", "inv-1", "cs_1", ordersClient, invoicesClient),
    ).rejects.toThrow(/status 400: bad/);
  });
});
