import { describe, it, expect } from "vitest";
import {
  paymentStageLabel,
  labelDeposits,
} from "../../src/services/payment-labels.js";
import type { InvoiceDepositView } from "../../src/lib/notion/invoice.schema.js";
import { ORDER_SERVICES } from "../../src/lib/service-catalog.js";

function deposit(
  overrides: Partial<InvoiceDepositView> = {},
): InvoiceDepositView {
  return {
    stage: "first_deposit",
    label: "First deposit",
    amount: 100,
    paid: false,
    ...overrides,
  };
}

const SECOND = deposit({ stage: "second_deposit", label: "Second deposit" });

describe("paymentStageLabel", () => {
  it("leaves a staged service's wording untouched", () => {
    expect(
      paymentStageLabel("first_deposit", "staged", "First deposit", {
        soleDeposit: true,
      }),
    ).toBe("First deposit");
    expect(paymentStageLabel("balance", "staged", "Final balance")).toBe(
      "Final balance",
    );
  });

  it("calls a lone deposit on a single-payment service just 'Deposit'", () => {
    expect(
      paymentStageLabel("first_deposit", "single", "First deposit", {
        soleDeposit: true,
      }),
    ).toBe("Deposit");
  });

  // The load-bearing case: two deposits both called "Deposit" would let a
  // customer pay the first and believe they were square. The ordinal is what
  // stops that, so it survives even on a single-payment service.
  it("keeps the ordinal when a single-payment order really has two deposits", () => {
    expect(
      paymentStageLabel("first_deposit", "single", "First deposit", {
        soleDeposit: false,
      }),
    ).toBe("First deposit");
    expect(
      paymentStageLabel("second_deposit", "single", "Second deposit", {
        soleDeposit: false,
      }),
    ).toBe("Second deposit");
  });

  it("plainly calls the balance 'Balance' on a single-payment service", () => {
    expect(paymentStageLabel("balance", "single", "Final balance")).toBe(
      "Balance",
    );
  });

  it("treats an unspecified soleDeposit as 'not sole' — the safe direction", () => {
    expect(paymentStageLabel("first_deposit", "single", "First deposit")).toBe(
      "First deposit",
    );
  });
});

describe("labelDeposits", () => {
  it("returns a staged service's list unchanged", () => {
    const deposits = [deposit()];
    expect(labelDeposits(deposits, "staged")).toBe(deposits);
  });

  it("relabels a lone deposit and never mutates the input", () => {
    const deposits = [deposit()];
    const labelled = labelDeposits(deposits, "single");

    expect(labelled[0].label).toBe("Deposit");
    expect(labelled[0].amount).toBe(100);
    expect(deposits[0].label).toBe("First deposit");
  });

  it("leaves two deposits with their ordinals", () => {
    const labelled = labelDeposits([deposit(), SECOND], "single");
    expect(labelled.map((d) => d.label)).toEqual([
      "First deposit",
      "Second deposit",
    ]);
  });

  it("handles an invoice with no deposits set", () => {
    expect(labelDeposits([], "single")).toEqual([]);
  });
});

// The relabelling only matters because the catalog says which services are
// which. Pin that here, so retiring a schedule can't silently go unnoticed.
describe("the catalog's payment schedules", () => {
  it("gives the bespoke commission the staged schedule and the rest a single payment", () => {
    const bySchedule = Object.fromEntries(
      ORDER_SERVICES.map((s) => [s.id, s.payment]),
    );
    expect(bySchedule).toEqual({
      bespoke: "staged",
      alterations: "single",
      rhinestoning: "single",
      repairs: "single",
    });
  });
});
