// The invoice PDF preview on the studio dashboard. The fetch helper is mocked —
// it has its own test — so what's covered here is the component's job: asking
// only once there's an order number, showing the server's reason when it
// refuses, and handing the document over as a frame plus download/open links
// through an object URL it releases when done.

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Mock } from "vitest";

const h = vi.hoisted(() => ({ fetchInvoicePdf: vi.fn() }));
vi.mock("@/lib/studio-invoice-pdf", () => ({
  fetchInvoicePdf: h.fetchInvoicePdf,
}));

import { InvoicePdfPreview } from "@/components/studio-invoice-pdf";

const fetchInvoicePdf = h.fetchInvoicePdf as unknown as Mock;

// jsdom has no object URLs; the component needs both halves.
const createObjectURL = vi.fn(() => "blob:invoice-1");
const revokeObjectURL = vi.fn();
beforeAll(() => {
  URL.createObjectURL = createObjectURL;
  URL.revokeObjectURL = revokeObjectURL;
});

beforeEach(() => {
  fetchInvoicePdf.mockReset();
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
});

describe("InvoicePdfPreview", () => {
  it("won't ask without an order number", () => {
    render(<InvoicePdfPreview orderNumber="   " />);
    expect(screen.getByTestId("invoice-pdf-preview-open")).toBeDisabled();
  });

  it("shows the document with download and open links", async () => {
    fetchInvoicePdf.mockResolvedValue({
      blob: new Blob(["%PDF"], { type: "application/pdf" }),
      filename: "AA-Atelier-Invoice-ORD-000002.pdf",
    });
    render(<InvoicePdfPreview orderNumber=" ORD-000002 " />);

    await userEvent.click(screen.getByTestId("invoice-pdf-preview-open"));

    expect(fetchInvoicePdf).toHaveBeenCalledWith("ORD-000002");
    const frame = await screen.findByTestId("invoice-pdf-preview-frame");
    expect(frame).toHaveAttribute("src", "blob:invoice-1");
    expect(screen.getByTestId("invoice-pdf-preview-download")).toHaveAttribute(
      "download",
      "AA-Atelier-Invoice-ORD-000002.pdf",
    );
    expect(screen.getByTestId("invoice-pdf-preview-open-tab")).toHaveAttribute(
      "href",
      "blob:invoice-1",
    );
    expect(
      screen.getByTestId("invoice-pdf-preview-document"),
    ).toHaveTextContent("Invoice ORD-000002");
  });

  it("shows the server's reason when it refuses", async () => {
    fetchInvoicePdf.mockRejectedValue(
      new Error("Invoice ORD-000002 isn't marked ready yet."),
    );
    render(<InvoicePdfPreview orderNumber="ORD-000002" />);

    await userEvent.click(screen.getByTestId("invoice-pdf-preview-open"));

    expect(
      await screen.findByTestId("invoice-pdf-preview-error"),
    ).toHaveTextContent("Invoice ORD-000002 isn't marked ready yet.");
    expect(
      screen.queryByTestId("invoice-pdf-preview-frame"),
    ).not.toBeInTheDocument();
  });

  it("releases the object URL when the preview goes away", async () => {
    fetchInvoicePdf.mockResolvedValue({
      blob: new Blob(["%PDF"], { type: "application/pdf" }),
      filename: "AA-Atelier-Invoice-ORD-000002.pdf",
    });
    const { unmount } = render(<InvoicePdfPreview orderNumber="ORD-000002" />);

    await userEvent.click(screen.getByTestId("invoice-pdf-preview-open"));
    await screen.findByTestId("invoice-pdf-preview-frame");

    unmount();
    await waitFor(() =>
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:invoice-1"),
    );
  });
});
