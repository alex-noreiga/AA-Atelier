// The production-pay panel. The generated hook is mocked, so what's tested is
// the panel's own job: leading with what each maker is owed and what it is owed
// for, showing a maker who is square as square rather than dropping them,
// listing the rows nothing could be worked out from instead of quietly
// totalling less than the truth, and saying WHICH database is missing when it
// isn't connected.
//
// The attribution RULES are pinned in the api-server's
// `production-pay.service.test.ts`; what's asserted here is that the panel
// renders what the server sends.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const h = vi.hoisted(() => ({
  pay: {
    data: undefined as unknown,
    isLoading: false,
    isError: false,
    error: null as unknown,
  },
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetStudioProductionPay: () => h.pay,
  getGetStudioProductionPayQueryKey: () => ["/api/studio/production-pay"],
}));

import { StudioProductionPay } from "@/components/studio-production-pay";

function overview(overrides: Record<string, unknown> = {}) {
  return {
    configured: true,
    makers: [],
    totalOwed: 0,
    totalPaid: 0,
    items: [],
    itemCount: 0,
    needsAttention: [],
    attentionCount: 0,
    unbalancedSplits: [],
    ...overrides,
  };
}

const ALEXANDRA = {
  maker: "Alexandra",
  owed: 250,
  paid: 100,
  total: 350,
  owedItems: 1,
  owedByStage: [
    { stage: "sewing", amount: 175 },
    { stage: "consult", amount: 75 },
  ],
};

const SQUARE = {
  maker: "Alayna",
  owed: 0,
  paid: 0,
  total: 0,
  owedItems: 0,
  owedByStage: [],
};

const ITEM = {
  id: "work-1",
  item: "Knight of Midnight Dress",
  category: "Dress",
  orderStage: "Fitting",
  value: 500,
  units: 1,
  makers: [
    {
      maker: "Alexandra",
      amount: 250,
      paid: false,
      stages: [
        { stage: "sewing", amount: 175, shared: false },
        { stage: "consult", amount: 75, shared: false },
      ],
    },
  ],
  unassigned: 0,
};

beforeEach(() => {
  h.pay = { data: undefined, isLoading: false, isError: false, error: null };
});

describe("StudioProductionPay", () => {
  it("shows a spinner while loading", () => {
    h.pay = { ...h.pay, isLoading: true };
    render(<StudioProductionPay />);

    expect(screen.getByTestId("production-pay-loading")).toBeInTheDocument();
  });

  it("leads with what each maker is owed, and what it is owed for", () => {
    h.pay = {
      ...h.pay,
      data: overview({ makers: [ALEXANDRA], totalOwed: 250, totalPaid: 100 }),
    };
    render(<StudioProductionPay />);

    const card = screen.getByTestId("maker-Alexandra");
    expect(card).toHaveTextContent("Alexandra");
    expect(card).toHaveTextContent("$250.00");
    expect(card).toHaveTextContent("owed across 1 item");
    // The breakdown is the thing a per-person Notion formula can't produce.
    expect(card).toHaveTextContent("Sewing");
    expect(card).toHaveTextContent("$175.00");
    expect(card).toHaveTextContent("Consult & sketch");
  });

  it("shows a maker with nothing outstanding, so this reads as the roster", () => {
    h.pay = { ...h.pay, data: overview({ makers: [ALEXANDRA, SQUARE] }) };
    render(<StudioProductionPay />);

    expect(screen.getByTestId("maker-Alayna")).toHaveTextContent(
      "nothing outstanding",
    );
  });

  it("badges the total owed in the heading", () => {
    h.pay = {
      ...h.pay,
      data: overview({ makers: [ALEXANDRA], totalOwed: 250 }),
    };
    render(<StudioProductionPay />);

    expect(screen.getByTestId("production-pay-owed-badge")).toHaveTextContent(
      "$250.00 owed",
    );
  });

  it("lists the items behind the figures when opened", () => {
    h.pay = {
      ...h.pay,
      data: overview({ makers: [ALEXANDRA], items: [ITEM], itemCount: 1 }),
    };
    render(<StudioProductionPay />);

    // Collapsed by default — the figures are the answer, the rows are the audit.
    expect(screen.queryByTestId("pay-item-work-1")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /1 item/ }));

    const row = screen.getByTestId("pay-item-work-1");
    expect(row).toHaveTextContent("Knight of Midnight Dress");
    expect(row).toHaveTextContent("Dress");
    expect(row).toHaveTextContent("Fitting");
    expect(row).toHaveTextContent("$250.00");
    expect(row).toHaveTextContent("owed");
  });

  it("marks a shared stage as shared", () => {
    const shared = {
      ...ITEM,
      makers: [
        {
          maker: "Alexandra",
          amount: 87.5,
          paid: false,
          stages: [{ stage: "sewing", amount: 87.5, shared: true }],
        },
      ],
    };
    h.pay = { ...h.pay, data: overview({ items: [shared], itemCount: 1 }) };
    render(<StudioProductionPay />);
    fireEvent.click(screen.getByRole("button", { name: /1 item/ }));

    expect(screen.getByTestId("pay-item-work-1")).toHaveTextContent(
      "Sewing (shared)",
    );
  });

  // The panel's most important job: a figure that looks complete while it is
  // short is the worst way for a payroll number to be wrong.
  it("names the rows nothing could be worked out from, and why", () => {
    h.pay = {
      ...h.pay,
      data: overview({
        needsAttention: [
          { id: "w-1", item: "Unpriced piece", reason: "no-sale-price" },
          { id: "w-2", item: "Uncategorised", reason: "no-pay-split" },
          {
            id: "w-3",
            item: "Half-assigned",
            reason: "unassigned-stages",
            unassigned: 175,
          },
        ],
        attentionCount: 3,
      }),
    };
    render(<StudioProductionPay />);

    expect(screen.getByTestId("pay-attention-w-1")).toHaveTextContent(
      "No sale price",
    );
    expect(screen.getByTestId("pay-attention-w-2")).toHaveTextContent(
      "No category",
    );
    expect(screen.getByTestId("pay-attention-w-3")).toHaveTextContent(
      "$175.00 of work has nobody against it",
    );
  });

  it("flags a category whose splits don't add up", () => {
    h.pay = {
      ...h.pay,
      data: overview({ unbalancedSplits: [{ category: "Bag", total: 0.9 }] }),
    };
    render(<StudioProductionPay />);

    const note = screen.getByTestId("production-pay-unbalanced");
    expect(note).toHaveTextContent("Bag");
    expect(note).toHaveTextContent("90%");
  });

  it("says nothing about splits when they all balance", () => {
    h.pay = { ...h.pay, data: overview({ makers: [ALEXANDRA] }) };
    render(<StudioProductionPay />);

    expect(
      screen.queryByTestId("production-pay-unbalanced"),
    ).not.toBeInTheDocument();
  });

  // Nought owed reads as "everyone has been paid", which is a very different
  // claim from "we aren't tracking this" — so it names the missing half.
  it("says which database is missing", () => {
    h.pay = {
      ...h.pay,
      data: overview({ configured: false, missing: ["pay-splits"] }),
    };
    render(<StudioProductionPay />);

    expect(screen.getByTestId("production-pay-unconfigured")).toHaveTextContent(
      "Category Pay Splits",
    );
  });

  it("says both are missing when neither is set", () => {
    h.pay = {
      ...h.pay,
      data: overview({
        configured: false,
        missing: ["work-distribution", "pay-splits"],
      }),
    };
    render(<StudioProductionPay />);

    expect(screen.getByTestId("production-pay-unconfigured")).toHaveTextContent(
      "NOTION_WORK_DISTRIBUTION_DATABASE_ID",
    );
  });

  it("gives the sharing fix when Notion can't see the database", () => {
    h.pay = { ...h.pay, data: overview({ unreachable: true }) };
    render(<StudioProductionPay />);

    expect(screen.getByTestId("production-pay-unreachable")).toHaveTextContent(
      "share each with the integration",
    );
  });

  it("renders the server's message on an error", () => {
    h.pay = { ...h.pay, isError: true, error: null };
    render(<StudioProductionPay />);

    expect(screen.getByTestId("production-pay-error")).toBeInTheDocument();
  });

  it("says so when no production work has been recorded", () => {
    h.pay = { ...h.pay, data: overview() };
    render(<StudioProductionPay />);

    expect(screen.getByTestId("production-pay-empty")).toBeInTheDocument();
  });
});
