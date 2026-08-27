// The shipping-label panel. The generated hooks are mocked, so what's tested is
// the panel's own job — being honest about what a press will do, given that the
// second one spends money that cannot be un-spent:
//
//  - rates before any purchase, and a confirm before the purchase itself;
//  - a test-mode token said out loud, since a test label looks entirely real;
//  - a bought-but-unrecorded label reported as bought, with the number to paste;
//  - an unconfigured vendor or ship-from address said plainly instead of a form
//    that could only fail.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

const h = vi.hoisted(() => ({
  options: {
    data: undefined as unknown,
    isLoading: false,
    isError: false,
    error: null as unknown,
  },
  rates: {
    mutate: vi.fn(),
    reset: vi.fn(),
    isPending: false,
    isError: false,
    error: null as unknown,
  },
  purchase: {
    mutate: vi.fn(),
    reset: vi.fn(),
    isPending: false,
    isError: false,
    error: null as unknown,
  },
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetShippingOptions: () => h.options,
  useGetShippingRates: () => h.rates,
  useBuyShippingLabel: () => h.purchase,
  getGetShippingOptionsQueryKey: () => ["/api/studio/shipments/options"],
}));

import { StudioShipping } from "@/components/studio-shipping";

const PARCELS = [
  {
    id: "box-small",
    name: "Small box",
    hint: "One competition dress, boxed flat",
    length: 12,
    width: 9,
    height: 4,
  },
  {
    id: "box-medium",
    name: "Medium box",
    hint: "A dress with a skirt that shouldn't be crushed",
    length: 16,
    width: 12,
    height: 6,
  },
];

function options(overrides: Record<string, unknown> = {}) {
  return {
    configured: true,
    testMode: false,
    shipFrom: ["A.A Atelier", "1200 Rink Road", "Austin TX 78701", "US"],
    problems: [],
    parcels: PARCELS,
    ...overrides,
  };
}

const RATE = {
  id: "rate_1",
  carrier: "USPS",
  service: "Ground Advantage",
  amount: 7.45,
  currency: "USD",
  estimatedDays: 3,
};

beforeEach(() => {
  h.options.data = options();
  h.options.isLoading = false;
  h.options.isError = false;
  h.rates.isPending = false;
  h.rates.isError = false;
  h.purchase.isPending = false;
  h.purchase.isError = false;
});

/** Fill the form and press "Get rates", returning the body that was sent. */
function requestRates(order = "SHP-ABC-0001", weight = "14") {
  fireEvent.change(screen.getByTestId("shipping-order-input"), {
    target: { value: order },
  });
  fireEvent.change(screen.getByTestId("shipping-weight-input"), {
    target: { value: weight },
  });
  fireEvent.click(screen.getByTestId("shipping-parcel-box-small"));
  fireEvent.click(screen.getByTestId("shipping-quote-button"));
  return h.rates.mutate.mock.calls.at(-1)?.[0];
}

/** Drive the rates mutation's onSuccess with a canned quote. Wrapped in `act`
 * because a mutation callback invoked by hand isn't inside React's own batching
 * the way a `fireEvent` handler is, so the state it sets wouldn't be flushed. */
function resolveRates(quote: Record<string, unknown>) {
  const onSuccess = h.rates.mutate.mock.calls.at(-1)?.[1]?.onSuccess;
  act(() => onSuccess?.(quote));
}

/** The same for the purchase mutation's onSuccess. */
function resolveLabel(label: Record<string, unknown>) {
  const onSuccess = h.purchase.mutate.mock.calls.at(-1)?.[1]?.onSuccess;
  act(() => onSuccess?.(label));
}

describe("StudioShipping", () => {
  it("says plainly when no vendor is connected, rather than offering a form", () => {
    h.options.data = options({
      configured: false,
      shipFrom: undefined,
      problems: ["No shipping vendor is connected. Set SHIPPO_API_KEY."],
    });
    render(<StudioShipping />);

    expect(screen.getByTestId("shipping-unavailable")).toBeTruthy();
    expect(screen.queryByTestId("shipping-quote-button")).toBeNull();
  });

  it("names an incomplete ship-from address as its own problem to fix", () => {
    h.options.data = options({
      shipFrom: undefined,
      problems: ["The studio's ship-from address is missing a postal code."],
    });
    render(<StudioShipping />);
    expect(screen.getByTestId("shipping-unavailable").textContent).toContain(
      "postal code",
    );
  });

  it("warns about test mode, because a test label looks entirely real", () => {
    h.options.data = options({ testMode: true });
    render(<StudioShipping />);
    expect(screen.getByTestId("shipping-test-mode").textContent).toContain(
      "test mode",
    );
  });

  it("shows where it posts from", () => {
    render(<StudioShipping />);
    expect(screen.getByTestId("shipping-from").textContent).toContain(
      "1200 Rink Road",
    );
  });

  it("asks for rates with the parcel and weight the atelier gave", () => {
    render(<StudioShipping />);
    const sent = requestRates();
    expect(sent).toEqual({
      data: {
        orderNumber: "SHP-ABC-0001",
        parcelId: "box-small",
        weightOz: 14,
      },
    });
  });

  it("won't ask for rates without an order number or a weight", () => {
    render(<StudioShipping />);
    expect(
      (screen.getByTestId("shipping-quote-button") as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    fireEvent.change(screen.getByTestId("shipping-order-input"), {
      target: { value: "SHP-ABC-0001" },
    });
    expect(
      (screen.getByTestId("shipping-quote-button") as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("shows the address it would post to, so a wrong one is caught by eye", () => {
    render(<StudioShipping />);
    requestRates();
    resolveRates({
      orderNumber: "SHP-ABC-0001",
      shipTo: ["A Skater", "9 Blade Way", "Denver CO 80202", "US"],
      rates: [RATE],
      notes: [],
    });

    expect(screen.getByTestId("shipping-rates").textContent).toContain(
      "9 Blade Way",
    );
  });

  it("buys nothing on the first press — money moves on the confirm", () => {
    render(<StudioShipping />);
    requestRates();
    resolveRates({
      orderNumber: "SHP-ABC-0001",
      shipTo: ["A Skater"],
      rates: [RATE],
      notes: [],
    });

    fireEvent.click(screen.getByTestId("shipping-buy-rate_1"));
    expect(h.purchase.mutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("shipping-confirm-rate_1"));
    expect(h.purchase.mutate.mock.calls.at(-1)?.[0]).toEqual({
      data: { orderNumber: "SHP-ABC-0001", rateId: "rate_1" },
    });
  });

  it("sends `replace` only when the atelier ticked it", () => {
    render(<StudioShipping />);
    requestRates();
    resolveRates({
      orderNumber: "SHP-ABC-0001",
      shipTo: ["A Skater"],
      rates: [RATE],
      notes: [],
    });

    fireEvent.click(screen.getByTestId("shipping-replace"));
    fireEvent.click(screen.getByTestId("shipping-buy-rate_1"));
    fireEvent.click(screen.getByTestId("shipping-confirm-rate_1"));

    expect(h.purchase.mutate.mock.calls.at(-1)?.[0]).toEqual({
      data: {
        orderNumber: "SHP-ABC-0001",
        rateId: "rate_1",
        replace: true,
      },
    });
  });

  it("explains an empty rate list instead of showing nothing", () => {
    render(<StudioShipping />);
    requestRates();
    resolveRates({
      orderNumber: "SHP-ABC-0001",
      shipTo: ["A Skater"],
      rates: [],
      notes: ["Your USPS account isn't connected."],
    });

    expect(screen.getByTestId("shipping-no-rates")).toBeTruthy();
    expect(screen.getByTestId("shipping-rate-notes").textContent).toContain(
      "USPS account",
    );
  });

  it("reports a bought label with its tracking number", () => {
    render(<StudioShipping />);
    requestRates();
    resolveRates({
      orderNumber: "SHP-ABC-0001",
      shipTo: ["A Skater"],
      rates: [RATE],
      notes: [],
    });
    fireEvent.click(screen.getByTestId("shipping-buy-rate_1"));
    fireEvent.click(screen.getByTestId("shipping-confirm-rate_1"));

    resolveLabel({
      orderNumber: "SHP-ABC-0001",
      carrier: "USPS",
      service: "Ground Advantage",
      amount: 7.45,
      currency: "USD",
      trackingNumber: "9400100000000000000000",
      labelUrl: "https://example.test/label.pdf",
      recorded: true,
      testMode: false,
    });

    expect(screen.getByTestId("shipping-tracking").textContent).toBe(
      "9400100000000000000000",
    );
    expect(screen.getByTestId("shipping-label-pdf")).toBeTruthy();
    // The quote is spent: leaving the list up invites a second label for the
    // same parcel against rate ids that are now bought or stale.
    expect(screen.queryByTestId("shipping-rates")).toBeNull();
  });

  it("reports an unrecorded label as bought, with what to do about it", () => {
    // The money is spent and the label is real; what's missing is a Notion row.
    render(<StudioShipping />);
    requestRates();
    resolveRates({
      orderNumber: "SHP-ABC-0001",
      shipTo: ["A Skater"],
      rates: [RATE],
      notes: [],
    });
    fireEvent.click(screen.getByTestId("shipping-buy-rate_1"));
    fireEvent.click(screen.getByTestId("shipping-confirm-rate_1"));

    resolveLabel({
      orderNumber: "SHP-ABC-0001",
      carrier: "USPS",
      service: "Ground Advantage",
      amount: 7.45,
      currency: "USD",
      trackingNumber: "9400100000000000000000",
      recorded: false,
      testMode: false,
    });

    const result =
      screen.getByTestId("shipping-label-result").textContent ?? "";
    expect(result).toContain("Label bought");
    expect(screen.getByTestId("shipping-not-recorded").textContent).toContain(
      "Tracking Number",
    );
    expect(screen.getByTestId("shipping-tracking").textContent).toBe(
      "9400100000000000000000",
    );
  });

  it("drops a stale quote the moment the parcel description changes", () => {
    // Rates are for the parcel that was described; a list left standing under a
    // changed weight is a rate the atelier would buy believing it covered it.
    render(<StudioShipping />);
    requestRates();
    resolveRates({
      orderNumber: "SHP-ABC-0001",
      shipTo: ["A Skater"],
      rates: [RATE],
      notes: [],
    });
    expect(screen.getByTestId("shipping-rates")).toBeTruthy();

    fireEvent.change(screen.getByTestId("shipping-weight-input"), {
      target: { value: "22" },
    });
    expect(screen.queryByTestId("shipping-rates")).toBeNull();
  });
});
