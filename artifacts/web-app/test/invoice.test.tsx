import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { orderRecord } from "@workspace/test-fixtures";
import type { Invoice } from "@workspace/api-client-react";
import { stubHook } from "./support/mock-hook.js";

// The invoice page reads its order number from the wouter route param; pin it.
vi.mock("wouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("wouter")>();
  return { ...actual, useParams: () => ({ orderNumber: "ORD-1" }) };
});

vi.mock("@workspace/api-client-react", () => ({
  useGetOrderStatus: vi.fn(),
  useCreateInvoicePayment: vi.fn(),
  getGetOrderStatusQueryKey: (n: string) => [n],
}));

import {
  useGetOrderStatus,
  useCreateInvoicePayment,
} from "@workspace/api-client-react";
import InvoicePage from "@/pages/invoice";

const mockHook = vi.mocked(useGetOrderStatus);
const mockPay = vi.mocked(useCreateInvoicePayment);
const payMutate = vi.fn();

const invoice: Invoice = {
  invoiceId: "Toothless",
  paid: false,
  lineItems: [
    { name: "Main fabric", type: "Material", amount: 40 },
    { name: "Rhinestones", type: "Material", amount: 55 },
    { name: "Construction", type: "Labor", amount: 120 },
  ],
  deposits: [
    { label: "Deposit 1", amount: 100, paid: true },
    { label: "Deposit 2", amount: 50, paid: false },
  ],
  subtotal: 215,
  depositsCreditedTotal: 100,
  balanceDue: 115,
};

beforeEach(() => {
  payMutate.mockReset();
  mockPay.mockReturnValue({ mutate: payMutate, isPending: false } as never);
});

describe("Invoice page render states", () => {
  it("shows the loading state", () => {
    stubHook(mockHook, { isLoading: true });
    render(<InvoicePage />);
    expect(screen.getByTestId("invoice-loading")).toBeInTheDocument();
  });

  it("shows a not-found message on error", () => {
    stubHook(mockHook, { isError: true });
    render(<InvoicePage />);
    expect(screen.getByTestId("invoice-error")).toBeInTheDocument();
  });

  it("shows a not-ready message when the order has no invoice yet", () => {
    stubHook(mockHook, { data: orderRecord() });
    render(<InvoicePage />);
    expect(screen.getByTestId("invoice-not-ready")).toBeInTheDocument();
  });
});

describe("Invoice breakdown", () => {
  it("groups line items, credits paid deposits, and shows the balance due", () => {
    stubHook(mockHook, { data: orderRecord({ invoice }) });
    render(<InvoicePage />);

    const card = screen.getByTestId("invoice");
    expect(within(card).getByText("Materials")).toBeInTheDocument();
    expect(within(card).getByText("Labor")).toBeInTheDocument();
    expect(within(card).getByText("Main fabric")).toBeInTheDocument();
    expect(within(card).getByText("Construction")).toBeInTheDocument();

    // Only the paid deposit is a credit; the unpaid one shows $0 + "(unpaid)".
    const deposits = screen.getAllByTestId("invoice-deposit");
    expect(deposits[0]).toHaveTextContent("Deposit 1");
    expect(deposits[0]).toHaveTextContent("−$100");
    expect(deposits[1]).toHaveTextContent("unpaid");

    expect(screen.getByTestId("invoice-balance")).toHaveTextContent("$115");
  });

  it("pays the balance for that order", async () => {
    stubHook(mockHook, { data: orderRecord({ invoice }) });
    render(<InvoicePage />);

    await userEvent.click(screen.getByTestId("button-pay-balance"));
    expect(payMutate).toHaveBeenCalledWith({ orderNumber: "ORD-1" });
  });

  it("confirms once paid and offers no pay button", () => {
    stubHook(mockHook, {
      data: orderRecord({ invoice: { ...invoice, paid: true, balanceDue: 0 } }),
    });
    render(<InvoicePage />);

    expect(screen.getByTestId("invoice-paid")).toBeInTheDocument();
    expect(screen.queryByTestId("button-pay-balance")).not.toBeInTheDocument();
  });
});
