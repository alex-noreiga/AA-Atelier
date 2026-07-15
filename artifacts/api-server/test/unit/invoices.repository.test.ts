import { describe, it, expect } from "vitest";
import {
  makeFakeClient,
  jsonResponse,
  errorResponse,
} from "../support/fake-notion.js";
import {
  findInvoiceById,
  markBalancePaid,
  computeBalanceDue,
} from "../../src/lib/notion/invoices.repository.js";

function invoicePage(
  overrides: {
    finalBalance?: number | null;
    balancePaid?: boolean;
    invoiceReady?: boolean;
  } = {},
) {
  const { finalBalance = 800, balancePaid = false, invoiceReady = true } =
    overrides;
  return {
    properties: {
      "Final Balance": {
        type: "rollup",
        rollup: { type: "number", number: finalBalance },
      },
      "Balance Paid": { type: "checkbox", checkbox: balancePaid },
      "Invoice Ready": { type: "checkbox", checkbox: invoiceReady },
    },
  };
}

describe("computeBalanceDue", () => {
  it("subtracts the deposit only once it has been paid", () => {
    expect(computeBalanceDue(800, 200, true)).toBe(600);
    expect(computeBalanceDue(800, 200, false)).toBe(800);
  });

  it("returns the full balance when no deposit was set", () => {
    expect(computeBalanceDue(800, undefined, true)).toBe(800);
  });
});

describe("findInvoiceById", () => {
  it("returns null without fetching when the invoices db id is unset", async () => {
    const client = makeFakeClient(() => {
      throw new Error("should not fetch");
    }, "");
    expect(await findInvoiceById("inv-1", client)).toBeNull();
    expect(client.calls).toHaveLength(0);
  });

  it("returns null without fetching when no invoice id is given", async () => {
    const client = makeFakeClient(() => {
      throw new Error("should not fetch");
    });
    expect(await findInvoiceById(undefined, client)).toBeNull();
    expect(client.calls).toHaveLength(0);
  });

  it("reads final balance, balance-paid and invoice-ready off the page", async () => {
    const client = makeFakeClient((path) => {
      if (path === "/v1/pages/inv-1") {
        return jsonResponse(
          invoicePage({ finalBalance: 800, balancePaid: false, invoiceReady: true }),
        );
      }
      throw new Error(`unexpected ${path}`);
    });

    expect(await findInvoiceById("inv-1", client)).toEqual({
      finalBalance: 800,
      balancePaid: false,
      invoiceReady: true,
    });
  });

  it("treats a missing/empty final-balance rollup as 0", async () => {
    const client = makeFakeClient(() =>
      jsonResponse(invoicePage({ finalBalance: null })),
    );
    const invoice = await findInvoiceById("inv-1", client);
    expect(invoice?.finalBalance).toBe(0);
  });

  it("throws on a non-ok response", async () => {
    const client = makeFakeClient(() => errorResponse(500));
    await expect(findInvoiceById("inv-1", client)).rejects.toThrow(
      /invoice fetch failed with status 500/,
    );
  });
});

describe("markBalancePaid", () => {
  it("PATCHes the invoice with the checkbox and session id", async () => {
    const client = makeFakeClient((path) => {
      if (path === "/v1/pages/inv-1") return jsonResponse({ id: "inv-1" });
      throw new Error(`unexpected ${path}`);
    });

    await markBalancePaid("inv-1", "cs_test_9", client);

    const call = client.calls[0];
    expect(call.path).toBe("/v1/pages/inv-1");
    expect(call.init?.method).toBe("PATCH");
    const body = JSON.parse(call.init!.body as string);
    expect(body.properties["Balance Paid"]).toEqual({ checkbox: true });
    expect(
      body.properties["Balance Payment Session Id"].rich_text[0].text.content,
    ).toBe("cs_test_9");
  });

  it("throws when the invoices db id is unset", async () => {
    const client = makeFakeClient(() => jsonResponse({}), "");
    await expect(markBalancePaid("inv-1", "cs_1", client)).rejects.toThrow(
      /NOTION_INVOICES_DATABASE_ID is not configured/,
    );
  });

  it("throws on a non-ok response", async () => {
    const client = makeFakeClient(() => errorResponse(400, "bad"));
    await expect(markBalancePaid("inv-1", "cs_1", client)).rejects.toThrow(
      /status 400: bad/,
    );
  });
});
