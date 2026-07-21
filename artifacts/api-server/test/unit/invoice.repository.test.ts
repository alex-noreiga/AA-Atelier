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
  markInvoicePaid,
  createInvoiceLineItem,
  setInvoiceTitle,
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
      deposits: [],
    });
  });

  it("maps the staged deposits that have an amount set", async () => {
    const client = makeFakeClient(() =>
      jsonResponse(
        invoicePage({
          id: "inv-1",
          firstDepositAmount: 100,
          firstDepositPaid: true,
          firstDepositSessionId: "cs_dep1",
          secondDepositAmount: 50,
          secondDepositPaid: false,
        }),
      ),
    );

    const invoice = await findInvoice("inv-1", client);
    expect(invoice?.deposits).toEqual([
      {
        stage: "first_deposit",
        label: "First deposit",
        amount: 100,
        paid: true,
        sessionId: "cs_dep1",
      },
      {
        stage: "second_deposit",
        label: "Second deposit",
        amount: 50,
        paid: false,
      },
    ]);
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

describe("markInvoicePaid", () => {
  it("PATCHes the invoice with a deposit stage's paid flag + session id", async () => {
    const client = makeFakeClient((path) => {
      if (path === "/v1/pages/inv-1") return jsonResponse({ id: "inv-1" });
      throw new Error(`unexpected ${path}`);
    });

    await markInvoicePaid("inv-1", "first_deposit", "cs_test_9", client);

    expect(client.calls[0].init?.method).toBe("PATCH");
    const body = JSON.parse(client.calls[0].init!.body as string);
    expect(body.properties["First Deposit Paid"]).toEqual({ checkbox: true });
    expect(
      body.properties["First Deposit Session Id"].rich_text[0].text.content,
    ).toBe("cs_test_9");
  });

  it("PATCHes the balance paid flag + session id for the balance stage", async () => {
    const client = makeFakeClient(() => jsonResponse({ id: "inv-1" }));

    await markInvoicePaid("inv-1", "balance", "cs_bal", client);

    const body = JSON.parse(client.calls[0].init!.body as string);
    expect(body.properties["Balance Paid"]).toEqual({ checkbox: true });
    expect(
      body.properties["Balance Payment Session Id"].rich_text[0].text.content,
    ).toBe("cs_bal");
  });

  it("throws when the update fails", async () => {
    const client = makeFakeClient(() => errorResponse(400, "bad"));
    await expect(
      markInvoicePaid("inv-1", "second_deposit", "cs_1", client),
    ).rejects.toThrow(/status 400: bad/);
  });
});

describe("createInvoiceLineItem", () => {
  it("POSTs a new line item priced via Manual Unit Price, with no costing-item link", async () => {
    const client = makeFakeClient((path) => {
      if (path === "/v1/pages") return jsonResponse({ id: "new-line" });
      throw new Error(`unexpected ${path}`);
    });

    await createInvoiceLineItem(
      {
        invoicePageId: "inv-1",
        orderPageId: "ord-1",
        name: "Red chiffon",
        lineType: "Material",
        unitPrice: 30,
        materialUsageLineId: "u1",
      },
      client,
    );

    expect(client.calls[0].init?.method).toBe("POST");
    const body = JSON.parse(client.calls[0].init!.body as string);
    expect(body.parent).toEqual({ database_id: "test-db-id" });
    expect(body.properties["Line Type"]).toEqual({
      select: { name: "Material" },
    });
    expect(body.properties["Manual Unit Price"]).toEqual({ number: 30 });
    expect(body.properties["Material Usage Line"]).toEqual({
      relation: [{ id: "u1" }],
    });
    // Deliberately never links the costing item (would re-introduce the double charge).
    expect(body.properties["Costing Item"]).toBeUndefined();
  });

  it("throws when creation fails", async () => {
    const client = makeFakeClient(() => errorResponse(400, "bad"));
    await expect(
      createInvoiceLineItem(
        {
          invoicePageId: "inv-1",
          orderPageId: "ord-1",
          name: "Labor",
          lineType: "Labor",
          unitPrice: 40,
        },
        client,
      ),
    ).rejects.toThrow(/status 400: bad/);
  });
});

describe("setInvoiceTitle", () => {
  it("PATCHes the Invoice ID title", async () => {
    const client = makeFakeClient((path) => {
      if (path === "/v1/pages/inv-1") return jsonResponse({ id: "inv-1" });
      throw new Error(`unexpected ${path}`);
    });

    await setInvoiceTitle("inv-1", "ORD-1", client);

    expect(client.calls[0].init?.method).toBe("PATCH");
    const body = JSON.parse(client.calls[0].init!.body as string);
    expect(body.properties["Invoice ID"].title[0].text.content).toBe("ORD-1");
  });

  it("throws when the update fails", async () => {
    const client = makeFakeClient(() => errorResponse(500, "boom"));
    await expect(setInvoiceTitle("inv-1", "ORD-1", client)).rejects.toThrow(
      /status 500: boom/,
    );
  });
});
