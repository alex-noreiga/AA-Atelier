// The plain-fetch helper behind the invoice PDF preview. It bypasses the
// generated client because the route answers with bytes, so the two things it
// has to get right on its own are tested: the request it makes, and turning a
// refusal into the message the dashboard shows.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: null,
  supabaseConfigured: false,
}));

import {
  fetchInvoicePdf,
  filenameFromDisposition,
} from "@/lib/studio-invoice-pdf";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchInvoicePdf", () => {
  it("asks the staff route for the order's PDF and names the file from the response", async () => {
    fetchMock.mockResolvedValue(
      new Response("%PDF-1.3", {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition":
            'inline; filename="AA-Atelier-Invoice-ORD-000002.pdf"',
        },
      }),
    );

    const file = await fetchInvoicePdf(" ORD-000002 ");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/studio/invoices/ORD-000002/pdf",
      expect.anything(),
    );
    expect(file.filename).toBe("AA-Atelier-Invoice-ORD-000002.pdf");
    expect(await file.blob.text()).toBe("%PDF-1.3");
  });

  it("falls back to the customer's own filename when the header is missing", async () => {
    fetchMock.mockResolvedValue(new Response("%PDF-1.3", { status: 200 }));
    const file = await fetchInvoicePdf("ORD-000002");
    expect(file.filename).toBe("AA-Atelier-Invoice-ORD-000002.pdf");
  });

  it("surfaces the server's reason for a refusal", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ error: "Invoice ORD-000002 isn't marked ready yet." }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      ),
    );
    await expect(fetchInvoicePdf("ORD-000002")).rejects.toThrow(
      "Invoice ORD-000002 isn't marked ready yet.",
    );
  });

  it("explains an expired session rather than showing nothing", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 401 }));
    await expect(fetchInvoicePdf("ORD-000002")).rejects.toThrow(
      /Sign in again/,
    );
  });
});

describe("filenameFromDisposition", () => {
  it("reads a quoted filename and ignores anything else", () => {
    expect(
      filenameFromDisposition('inline; filename="AA-Atelier-Invoice-X.pdf"'),
    ).toBe("AA-Atelier-Invoice-X.pdf");
    expect(filenameFromDisposition("inline")).toBeUndefined();
    expect(filenameFromDisposition(null)).toBeUndefined();
  });
});
