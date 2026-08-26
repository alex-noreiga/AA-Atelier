import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  createOrderInput,
  colorList,
  serviceList,
} from "@workspace/test-fixtures";

// Capture what the create-order mutation is called with, without hitting the
// network. `vi.hoisted` makes the spy available inside the hoisted vi.mock.
const {
  mutate,
  subscribeMutate,
  colorsResult,
  servicesResult,
  capacityResult,
} = vi.hoisted(() => ({
  mutate: vi.fn(),
  subscribeMutate: vi.fn(),
  // Mutable so a test can swap in an empty/errored colors result.
  colorsResult: { current: { data: undefined as unknown } },
  // Likewise for the service catalog — an empty result is the degraded path
  // where the form falls back to the bespoke shape.
  servicesResult: { current: { data: undefined as unknown } },
  // The commission-capacity answer. Undefined is the degraded/loading path, in
  // which the intake form renders as it always has; a test closing the books
  // swaps in a definite `open: false`.
  capacityResult: { current: { data: undefined as unknown } },
}));
vi.mock("@workspace/api-client-react", () => ({
  useCreateOrder: () => ({ mutate, isPending: false }),
  useSubscribeNewsletter: () => ({ mutate: subscribeMutate, isPending: false }),
  useGetColors: () => colorsResult.current,
  useGetServices: () => servicesResult.current,
  useGetCapacity: () => capacityResult.current,
}));

import OrderForm from "@/pages/order-form";

// Default the colors query to a populated palette; a test can override
// `colorsResult.current` to exercise the empty/degraded path.
beforeEach(() => {
  colorsResult.current = { data: colorList() };
  servicesResult.current = { data: serviceList() };
  capacityResult.current = { data: undefined };
});

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`no element with id ${id}`);
  return el;
}

/**
 * Type the shared valid-order fixture into step 0 (contact + measurements). The
 * assertions below are written out by hand rather than derived from the fixture:
 * this is a round-trip test (type a value, expect it in the payload), so the
 * expectation has to be able to disagree with the input.
 */
async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
  const order = createOrderInput();
  // The service is picked first and decides what the rest of the form asks for;
  // the commission is the one that still asks for measurements.
  await user.click(screen.getByTestId("service-option-bespoke"));
  await user.type(byId("fullName"), order.fullName);
  await user.type(byId("email"), order.email);
  await user.type(byId("phone"), order.phone);
  await user.click(screen.getByRole("button", { name: "Email" }));
  await user.type(byId("waist"), String(order.waist));
  await user.type(byId("bust"), String(order.bust));
  await user.type(byId("hips"), String(order.hips));
  await user.type(byId("height"), String(order.height));
  await user.type(byId("bodyGirth"), String(order.bodyGirth));
}

// The intake is a three-step flow. Step 0 (details) holds every required field;
// step 1 (design) is colors + costume details; step 2 (timeline) is the
// needed-by date, the rush disclosure, referral and the final "Submit Order".
// Both later steps are entirely optional, so each helper waits on the *next*
// step's button to confirm the advance landed.
async function continueToDesign(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    screen.getByRole("button", { name: /continue to your piece/i }),
  );
  await screen.findByRole("button", { name: /continue to timeline/i });
}

async function continueToTimeline(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    screen.getByRole("button", { name: /continue to timeline/i }),
  );
  await screen.findByRole("button", { name: "Submit Order" });
}

/** Walk from step 0 to the final step, skipping both optional ones. */
async function continueToSubmit(user: ReturnType<typeof userEvent.setup>) {
  await continueToDesign(user);
  await continueToTimeline(user);
}

describe("OrderForm submission mapping", () => {
  it("omits empty optional fields (description, neededBy) from the payload", async () => {
    const user = userEvent.setup();
    render(<OrderForm />);
    await fillRequired(user);
    await continueToSubmit(user);
    await user.click(screen.getByRole("button", { name: "Submit Order" }));

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    const { data } = mutate.mock.calls[0][0];
    expect(data).not.toHaveProperty("description");
    expect(data).not.toHaveProperty("neededBy");
    // Required values are coerced/typed as the contract expects.
    expect(data).toMatchObject({
      fullName: "Ada Lovelace",
      email: "ada@example.com",
      preferredContact: "email",
      measurementUnit: "inches",
      waist: 28,
      bodyGirth: 32,
    });
  });

  it("omits measurements and flags an appointment when that mode is chosen", async () => {
    const user = userEvent.setup();
    render(<OrderForm />);

    const order = createOrderInput();
    await user.click(screen.getByTestId("service-option-bespoke"));
    await user.type(byId("fullName"), order.fullName);
    await user.type(byId("email"), order.email);
    await user.type(byId("phone"), order.phone);
    await user.click(screen.getByRole("button", { name: "Email" }));
    await user.click(
      screen.getByRole("button", { name: "Take them at an appointment" }),
    );
    // The measurement inputs are gone in appointment mode.
    expect(document.getElementById("waist")).toBeNull();

    // The appointment panel deliberately offers NO fitting link: a fitting is
    // booked against an order number the customer doesn't have until this form
    // is submitted, so the link is only on the confirmation screen.
    expect(screen.queryByTestId("link-book-fitting")).toBeNull();

    await continueToSubmit(user);
    await user.click(screen.getByRole("button", { name: "Submit Order" }));

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    const { data } = mutate.mock.calls[0][0];
    expect(data.measurementAppointment).toBe(true);
    expect(data).not.toHaveProperty("waist");
    expect(data).not.toHaveProperty("bodyGirth");
    expect(data).not.toHaveProperty("measurementUnit");
    expect(data).toMatchObject({
      fullName: "Ada Lovelace",
      email: "ada@example.com",
      preferredContact: "email",
    });
  });

  it("includes description and neededBy when they are provided", async () => {
    const user = userEvent.setup();
    render(<OrderForm />);
    await fillRequired(user);
    // Description lives on the design step, needed-by on the timeline step.
    await continueToDesign(user);
    await user.type(byId("description"), "Ivory chiffon, A-line");
    await continueToTimeline(user);
    // A standard-timeline date, well outside the rush window, so the rush-
    // surcharge acknowledgement gate doesn't block submit. Kept relative to
    // today (not a fixed date) so it can't drift into the window over time.
    // Date inputs don't play well with per-character typing; set directly.
    const neededBy = isoDaysFromNow(90);
    fireEvent.change(byId("neededBy"), { target: { value: neededBy } });

    await user.click(screen.getByRole("button", { name: "Submit Order" }));

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    const { data } = mutate.mock.calls[0][0];
    expect(data.description).toBe("Ivory chiffon, A-line");
    expect(data.neededBy).toBe(neededBy);
  });

  it("omits referralCode when left blank", async () => {
    const user = userEvent.setup();
    render(<OrderForm />);
    await fillRequired(user);
    await continueToSubmit(user);
    await user.click(screen.getByRole("button", { name: "Submit Order" }));

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(mutate.mock.calls[0][0].data).not.toHaveProperty("referralCode");
  });

  it("includes a trimmed referralCode when provided", async () => {
    const user = userEvent.setup();
    render(<OrderForm />);
    await fillRequired(user);
    await continueToSubmit(user);
    // The referral field is on the final (timeline) step.
    await user.type(byId("referralCode"), "  AA-ABC123  ");
    await user.click(screen.getByRole("button", { name: "Submit Order" }));

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(mutate.mock.calls[0][0].data.referralCode).toBe("AA-ABC123");
  });
});

/** An ISO yyyy-mm-dd date `days` from now, for exercising the rush window. */
function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

describe("OrderForm steps", () => {
  it("keeps the design and timeline fields off the first step", async () => {
    render(<OrderForm />);
    // Colors and costume details belong to step 1...
    expect(screen.queryByTestId("color-picker")).not.toBeInTheDocument();
    expect(document.getElementById("description")).toBeNull();
    // ...and the timeline/referral fields to step 2.
    expect(document.getElementById("neededBy")).toBeNull();
    expect(document.getElementById("referralCode")).toBeNull();
  });

  it("steps back to the design step and keeps what was entered", async () => {
    const user = userEvent.setup();
    render(<OrderForm />);
    await fillRequired(user);
    await continueToDesign(user);
    await user.type(byId("description"), "Ivory chiffon, A-line");
    await continueToTimeline(user);

    await user.click(screen.getByTestId("button-back-to-design"));

    expect(await screen.findByLabelText(/Description/i)).toHaveValue(
      "Ivory chiffon, A-line",
    );
  });

  it("steps all the way back to the details step and keeps what was entered", async () => {
    const user = userEvent.setup();
    render(<OrderForm />);
    await fillRequired(user);
    await continueToSubmit(user);

    await user.click(screen.getByTestId("button-back-to-design"));
    await user.click(await screen.findByTestId("button-back-to-details"));

    expect(await screen.findByLabelText(/Full Name/i)).toHaveValue(
      "Ada Lovelace",
    );
    expect(byId("waist")).toHaveValue(28);
  });

  it("keeps the customer on the final step when only that step has an error", async () => {
    const user = userEvent.setup();
    render(<OrderForm />);
    await fillRequired(user);
    await continueToSubmit(user);
    fireEvent.change(byId("neededBy"), { target: { value: "2020-01-01" } });

    await user.click(screen.getByRole("button", { name: "Submit Order" }));

    expect(
      await screen.findByText("Please choose a date in the future"),
    ).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
    // Still on the last step, with the message in view.
    expect(
      screen.getByRole("button", { name: "Submit Order" }),
    ).toBeInTheDocument();
  });
});

describe("OrderForm rush order", () => {
  it("shows the rush notice and blocks submit until the surcharge is acknowledged", async () => {
    const user = userEvent.setup();
    render(<OrderForm />);
    await fillRequired(user);
    await continueToSubmit(user);
    // A date well inside the rush window (5 days out). Needed-by now lives on
    // the final step, so the disclosure surfaces there too.
    fireEvent.change(byId("neededBy"), {
      target: { value: isoDaysFromNow(5) },
    });

    expect(screen.getByTestId("rush-notice")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Submit Order" }));

    expect(
      await screen.findByText(/acknowledge the rush surcharge/i),
    ).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
    // The unacknowledged surcharge keeps us on the step that shows it.
    expect(screen.getByTestId("rush-notice")).toBeInTheDocument();
  });

  it("sends rush: true once the surcharge is acknowledged", async () => {
    const user = userEvent.setup();
    render(<OrderForm />);
    await fillRequired(user);
    await continueToSubmit(user);
    fireEvent.change(byId("neededBy"), {
      target: { value: isoDaysFromNow(5) },
    });
    await user.click(screen.getByTestId("rush-acknowledge"));
    await user.click(screen.getByRole("button", { name: "Submit Order" }));

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    const { data } = mutate.mock.calls[0][0];
    expect(data.rush).toBe(true);
  });

  it("does not flag a standard-timeline date as a rush order", async () => {
    const user = userEvent.setup();
    render(<OrderForm />);
    await fillRequired(user);
    await continueToSubmit(user);
    // Comfortably outside the rush window.
    fireEvent.change(byId("neededBy"), {
      target: { value: isoDaysFromNow(90) },
    });

    expect(screen.queryByTestId("rush-notice")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Submit Order" }));

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    const { data } = mutate.mock.calls[0][0];
    expect(data).not.toHaveProperty("rush");
  });
});

describe("OrderForm newsletter opt-in", () => {
  it("does not subscribe when the box is left unticked", async () => {
    const user = userEvent.setup();
    render(<OrderForm />);
    await fillRequired(user);
    await continueToSubmit(user);
    await user.click(screen.getByRole("button", { name: "Submit Order" }));

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(subscribeMutate).not.toHaveBeenCalled();
  });

  it("subscribes with the order email and 'order form' source when ticked", async () => {
    const user = userEvent.setup();
    render(<OrderForm />);
    await fillRequired(user);
    await continueToSubmit(user);
    // The opt-in sits on the final step, next to Submit.
    await user.click(screen.getByTestId("subscribe-newsletter"));
    await user.click(screen.getByRole("button", { name: "Submit Order" }));

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(subscribeMutate).toHaveBeenCalledTimes(1);
    const { data } = subscribeMutate.mock.calls[0][0];
    expect(data).toMatchObject({
      email: "ada@example.com",
      source: "order form",
    });
    expect(typeof data.elapsedMs).toBe("number");
  });
});

describe("OrderForm validation", () => {
  it("blocks advancing and shows messages when required fields are empty", async () => {
    const user = userEvent.setup();
    render(<OrderForm />);
    await user.click(
      screen.getByRole("button", { name: /continue to your piece/i }),
    );

    expect(
      await screen.findByText("Full name is required"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Please enter a valid email address"),
    ).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
    // Validation kept us on step 0.
    expect(
      screen.queryByRole("button", { name: /continue to timeline/i }),
    ).not.toBeInTheDocument();
  });

  it("rejects a needed-by date in the past", async () => {
    const user = userEvent.setup();
    render(<OrderForm />);
    await fillRequired(user);
    await continueToSubmit(user);
    fireEvent.change(byId("neededBy"), { target: { value: "2020-01-01" } });

    await user.click(screen.getByRole("button", { name: "Submit Order" }));

    expect(
      await screen.findByText("Please choose a date in the future"),
    ).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });
});

describe("OrderForm deposit expectation", () => {
  it("sets the expectation that a deposit follows the quote", async () => {
    const user = userEvent.setup();
    render(<OrderForm />);
    await fillRequired(user);
    await continueToSubmit(user);
    // The deposit note sits by the final Submit on the last step.
    expect(screen.getByTestId("deposit-note")).toHaveTextContent(
      /deposit to reserve your place/i,
    );
  });
});

describe("OrderForm color selector", () => {
  it("renders the palette chips on the design step", async () => {
    const user = userEvent.setup();
    render(<OrderForm />);
    // The palette lives on step 1, not the initial page.
    expect(screen.queryByTestId("color-picker")).not.toBeInTheDocument();
    await fillRequired(user);
    await continueToDesign(user);
    expect(screen.getByTestId("color-picker")).toBeInTheDocument();
    expect(screen.getByTestId("color-ivory")).toBeInTheDocument();
  });

  it("sends the picked colors and the usage note", async () => {
    const user = userEvent.setup();
    render(<OrderForm />);
    await fillRequired(user);
    await continueToDesign(user);
    await user.click(screen.getByTestId("color-ivory"));
    await user.click(screen.getByTestId("color-emerald"));
    await user.type(byId("colorUsage"), "Ivory bodice, emerald skirt");
    await continueToTimeline(user);
    await user.click(screen.getByRole("button", { name: "Submit Order" }));

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    const { data } = mutate.mock.calls[0][0];
    // Colors are sent as the picked names, in selection order.
    expect(data.colors).toEqual(["Ivory", "Emerald"]);
    expect(data.colorUsage).toBe("Ivory bodice, emerald skirt");
  });

  it("omits colors and colorUsage when none are provided", async () => {
    const user = userEvent.setup();
    render(<OrderForm />);
    await fillRequired(user);
    await continueToSubmit(user);
    await user.click(screen.getByRole("button", { name: "Submit Order" }));

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    const { data } = mutate.mock.calls[0][0];
    expect(data).not.toHaveProperty("colors");
    expect(data).not.toHaveProperty("colorUsage");
  });

  it("deselecting a chip removes it from the sent colors", async () => {
    const user = userEvent.setup();
    render(<OrderForm />);
    await fillRequired(user);
    await continueToDesign(user);
    await user.click(screen.getByTestId("color-ivory"));
    await user.click(screen.getByTestId("color-ivory")); // toggle back off
    await continueToTimeline(user);
    await user.click(screen.getByRole("button", { name: "Submit Order" }));

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    const { data } = mutate.mock.calls[0][0];
    expect(data).not.toHaveProperty("colors");
  });

  it("still submits when the palette is empty (degraded), usage note only", async () => {
    colorsResult.current = { data: undefined };
    const user = userEvent.setup();
    render(<OrderForm />);
    await fillRequired(user);
    await continueToDesign(user);
    // No chips render, but the customer can still describe what they want.
    expect(screen.queryByTestId("color-picker")).not.toBeInTheDocument();
    await user.type(byId("colorUsage"), "Deep teal, please");
    await continueToTimeline(user);
    await user.click(screen.getByRole("button", { name: "Submit Order" }));

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    const { data } = mutate.mock.calls[0][0];
    expect(data).not.toHaveProperty("colors");
    expect(data.colorUsage).toBe("Deep teal, please");
  });
});

describe("OrderForm service catalog", () => {
  /** Step 0 for a service that asks for nothing but contact details. */
  async function fillContactOnly(user: ReturnType<typeof userEvent.setup>) {
    const order = createOrderInput();
    await user.type(byId("fullName"), order.fullName);
    await user.type(byId("email"), order.email);
    await user.type(byId("phone"), order.phone);
    await user.click(screen.getByRole("button", { name: "Email" }));
  }

  it("blocks advancing until a service is picked", async () => {
    const user = userEvent.setup();
    render(<OrderForm />);
    await fillContactOnly(user);
    await user.click(
      screen.getByRole("button", { name: /continue to your piece/i }),
    );

    expect(
      await screen.findByText("Please choose the service you'd like"),
    ).toBeInTheDocument();
    // Still on step 0.
    expect(
      screen.queryByRole("button", { name: /continue to timeline/i }),
    ).not.toBeInTheDocument();
  });

  it("drops the measurements section for a service that doesn't need them", async () => {
    const user = userEvent.setup();
    render(<OrderForm />);
    expect(byId("waist")).toBeInTheDocument();

    await user.click(screen.getByTestId("service-option-repairs"));

    // Not merely un-required — the whole section is gone, including the
    // "take them at an appointment" alternative.
    expect(document.getElementById("waist")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Take them at an appointment" }),
    ).not.toBeInTheDocument();
  });

  it("requires the brief for a service worked on a piece the customer owns", async () => {
    const user = userEvent.setup();
    render(<OrderForm />);
    await user.click(screen.getByTestId("service-option-repairs"));
    await fillContactOnly(user);
    await continueToDesign(user);

    // The field is labelled and prompted by the service, and the colour picker
    // is gone — a repair works with what the garment already is.
    expect(
      screen.getByLabelText(/The piece and what needs repairing/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("color-picker")).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /continue to timeline/i }),
    );
    expect(
      await screen.findByText(
        "Please tell us about the piece and what you'd like done",
      ),
    ).toBeInTheDocument();
  });

  it("drops colours picked before switching to a service that doesn't offer them", async () => {
    const user = userEvent.setup();
    render(<OrderForm />);
    await user.click(screen.getByTestId("service-option-bespoke"));
    await fillContactOnly(user);
    await user.type(byId("waist"), "28");
    await user.type(byId("bust"), "36");
    await user.type(byId("hips"), "38");
    await user.type(byId("height"), "65");
    await user.type(byId("bodyGirth"), "32");
    await continueToDesign(user);
    await user.click(screen.getByTestId("color-ivory"));

    // Change of mind: back to step 0 and pick the repair instead.
    await user.click(screen.getByTestId("button-back-to-details"));
    await user.click(await screen.findByTestId("service-option-repairs"));
    await continueToDesign(user);
    await user.type(byId("description"), "Torn seam at the waist");
    await continueToTimeline(user);
    await user.click(screen.getByRole("button", { name: "Submit Order" }));

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    const { data } = mutate.mock.calls[0][0];
    expect(data.service).toBe("repairs");
    // Neither the colours nor the measurements the bespoke form collected.
    expect(data).not.toHaveProperty("colors");
    expect(data).not.toHaveProperty("colorUsage");
    expect(data).not.toHaveProperty("waist");
  });

  it("sends the picked service and no measurements for a repair", async () => {
    const user = userEvent.setup();
    render(<OrderForm />);
    await user.click(screen.getByTestId("service-option-repairs"));
    await fillContactOnly(user);
    await continueToDesign(user);
    await user.type(byId("description"), "Lost stones on the left shoulder");
    await continueToTimeline(user);
    await user.click(screen.getByRole("button", { name: "Submit Order" }));

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    const { data } = mutate.mock.calls[0][0];
    expect(data.service).toBe("repairs");
    expect(data.description).toBe("Lost stones on the left shoulder");
    expect(data).not.toHaveProperty("waist");
    expect(data).not.toHaveProperty("measurementUnit");
    // Not a deferred measurement either — this service never asked.
    expect(data).not.toHaveProperty("measurementAppointment");
  });

  it("falls back to the bespoke form when the catalog can't be read", async () => {
    const user = userEvent.setup();
    servicesResult.current = { data: undefined };
    render(<OrderForm />);

    // No picker to answer, so nothing to be blocked behind — and the form is
    // the full commission intake it was before services existed.
    expect(screen.queryByTestId("service-picker")).not.toBeInTheDocument();
    expect(byId("waist")).toBeInTheDocument();

    const order = createOrderInput();
    await user.type(byId("fullName"), order.fullName);
    await user.type(byId("email"), order.email);
    await user.type(byId("phone"), order.phone);
    await user.click(screen.getByRole("button", { name: "Email" }));
    await user.type(byId("waist"), String(order.waist));
    await user.type(byId("bust"), String(order.bust));
    await user.type(byId("hips"), String(order.hips));
    await user.type(byId("height"), String(order.height));
    await user.type(byId("bodyGirth"), String(order.bodyGirth));
    await continueToSubmit(user);
    await user.click(screen.getByRole("button", { name: "Submit Order" }));

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    const { data } = mutate.mock.calls[0][0];
    // The server reads an order with no service as a bespoke commission.
    expect(data).not.toHaveProperty("service");
    expect(data.waist).toBe(28);
  });
});
