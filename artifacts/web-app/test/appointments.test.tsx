import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Capture the booking mutation payload and control the two query hooks, without
// touching the network. `vi.hoisted` exposes the spies to the hoisted vi.mock.
const { mutate, optionsState, availabilityState } = vi.hoisted(() => ({
  mutate: vi.fn(),
  optionsState: { current: {} as Record<string, unknown> },
  availabilityState: { current: {} as Record<string, unknown> },
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetAppointmentOptions: () => optionsState.current,
  useGetAppointmentAvailability: () => availabilityState.current,
  getGetAppointmentAvailabilityQueryKey: () => ["availability"],
  useCreateAppointment: () => ({ mutate, isPending: false }),
}));

import Appointments from "@/pages/appointments";

const OPTIONS = {
  timezone: "UTC",
  types: [
    {
      id: "consultation",
      name: "Consultation",
      durationMinutes: 30,
      description: "Talk through ideas.",
      staff: ["Alexandra", "Alayna"],
      locations: ["in-person", "virtual"],
      requiresProjectDetails: true,
    },
    {
      id: "fitting",
      name: "Fitting & Measurements",
      durationMinutes: 60,
      description: "In person only.",
      staff: ["Alexandra"],
      locations: ["in-person"],
      requiresOrder: true,
    },
  ],
};

const SLOT_ISO = "2026-07-20T09:00:00.000Z";

beforeEach(() => {
  // Reset the URL so a prior test's deep-link query can't leak into the next.
  window.history.replaceState({}, "", "/");
  optionsState.current = {
    data: OPTIONS,
    isLoading: false,
    isError: false,
  };
  availabilityState.current = {
    data: {
      timezone: "UTC",
      slots: [
        {
          start: SLOT_ISO,
          end: "2026-07-20T09:30:00.000Z",
          staff: "Alexandra",
        },
      ],
    },
    isLoading: false,
    isError: false,
    isSuccess: true,
  };
});

describe("Appointments booking flow", () => {
  it("lists the bookable types from the options endpoint", () => {
    render(<Appointments />);
    expect(screen.getByTestId("type-consultation")).toHaveTextContent(
      "Consultation",
    );
    expect(screen.getByTestId("type-fitting")).toHaveTextContent(
      "Fitting & Measurements",
    );
  });

  it("skips the format step for a single-staff, single-location type", async () => {
    const user = userEvent.setup();
    render(<Appointments />);
    // Fitting has one location + one staff → straight to the time step.
    await user.click(screen.getByTestId("type-fitting"));
    expect(await screen.findByTestId("step-time")).toBeInTheDocument();
  });

  it("preselects the type from a ?type= deep link once options load", async () => {
    // The "Book your fitting" links elsewhere point here with ?type=fitting.
    window.history.replaceState({}, "", "/appointments?type=fitting");
    render(<Appointments />);
    // Preselecting fitting (single staff + location) advances past the Purpose
    // step straight to the time step, without a click.
    expect(await screen.findByTestId("step-time")).toBeInTheDocument();
    expect(screen.queryByTestId("type-consultation")).not.toBeInTheDocument();
  });

  it("ignores an unknown ?type= value and starts at the Purpose step", async () => {
    window.history.replaceState({}, "", "/appointments?type=nonsense");
    render(<Appointments />);
    // Unknown type → no preselect; the type picker is still shown.
    expect(screen.getByTestId("type-fitting")).toBeInTheDocument();
    expect(screen.queryByTestId("step-time")).not.toBeInTheDocument();
  });

  it("maps the full booking to the mutation payload, omitting staff for 'no preference'", async () => {
    const user = userEvent.setup();
    render(<Appointments />);

    await user.click(screen.getByTestId("type-consultation"));
    // Format step: pick location + no-preference staff.
    await user.click(screen.getByRole("button", { name: "In person" }));
    await user.click(screen.getByRole("button", { name: "No preference" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));

    // Time step: choose the one open slot.
    await user.click(await screen.findByTestId(`slot-${SLOT_ISO}`));

    // Details step: fill required fields and confirm.
    const details = await screen.findByTestId("step-details");
    expect(details).toBeInTheDocument();
    await user.type(document.getElementById("fullName")!, "Ada Lovelace");
    await user.type(document.getElementById("email")!, "ada@example.com");
    // Consultation requires project details (the funnel gate).
    await user.type(
      document.getElementById("projectDetails")!,
      "A competition dress in navy.",
    );
    await user.click(screen.getByRole("button", { name: "Confirm Booking" }));

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    const { data } = mutate.mock.calls[0][0];
    expect(data).toMatchObject({
      typeId: "consultation",
      location: "in-person",
      start: SLOT_ISO,
      fullName: "Ada Lovelace",
      email: "ada@example.com",
      projectDetails: "A competition dress in navy.",
    });
    expect(data).not.toHaveProperty("staff");
  });

  it("blocks a consultation with no project details (funnel gate)", async () => {
    const user = userEvent.setup();
    render(<Appointments />);

    await user.click(screen.getByTestId("type-consultation"));
    await user.click(screen.getByRole("button", { name: "In person" }));
    await user.click(screen.getByRole("button", { name: "No preference" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(await screen.findByTestId(`slot-${SLOT_ISO}`));

    await screen.findByTestId("step-details");
    await user.type(document.getElementById("fullName")!, "Ada Lovelace");
    await user.type(document.getElementById("email")!, "ada@example.com");
    // Leave project details blank.
    await user.click(screen.getByRole("button", { name: "Confirm Booking" }));

    expect(
      await screen.findByText("Please tell us a little about your project."),
    ).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("requires an order number for a fitting and sends it (order gate)", async () => {
    const user = userEvent.setup();
    render(<Appointments />);

    // Fitting is single-staff + single-location → straight to the time step.
    await user.click(screen.getByTestId("type-fitting"));
    await user.click(await screen.findByTestId(`slot-${SLOT_ISO}`));

    await screen.findByTestId("step-details");
    await user.type(document.getElementById("fullName")!, "Ada Lovelace");
    await user.type(document.getElementById("email")!, "ada@example.com");
    // Submit with no order number → blocked.
    await user.click(screen.getByRole("button", { name: "Confirm Booking" }));
    expect(
      await screen.findByText(
        "Your order number is required for this appointment.",
      ),
    ).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();

    // Provide it, and the booking goes through with orderNumber in the payload.
    await user.type(document.getElementById("orderNumber")!, "000123");
    await user.click(screen.getByRole("button", { name: "Confirm Booking" }));

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    const { data } = mutate.mock.calls[0][0];
    expect(data).toMatchObject({
      typeId: "fitting",
      orderNumber: "000123",
    });
  });

  // --- The text-alert opt-in ------------------------------------------------
  //
  // The capture surface for a customer who has never placed an order.

  it("sends no smsConsent when the box is left unticked", async () => {
    const user = userEvent.setup();
    render(<Appointments />);

    await user.click(screen.getByTestId("type-fitting"));
    await user.click(await screen.findByTestId(`slot-${SLOT_ISO}`));
    await screen.findByTestId("step-details");
    await user.type(document.getElementById("fullName")!, "Ada Lovelace");
    await user.type(document.getElementById("email")!, "ada@example.com");
    await user.type(document.getElementById("orderNumber")!, "000123");
    await user.click(screen.getByRole("button", { name: "Confirm Booking" }));

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(mutate.mock.calls[0][0].data).not.toHaveProperty("smsConsent");
  });

  it("sends smsConsent with the number when ticked", async () => {
    const user = userEvent.setup();
    render(<Appointments />);

    await user.click(screen.getByTestId("type-fitting"));
    await user.click(await screen.findByTestId(`slot-${SLOT_ISO}`));
    await screen.findByTestId("step-details");
    await user.type(document.getElementById("fullName")!, "Ada Lovelace");
    await user.type(document.getElementById("email")!, "ada@example.com");
    await user.type(document.getElementById("orderNumber")!, "000123");
    await user.type(document.getElementById("phone")!, "512-555-0123");
    await user.click(screen.getByTestId("appointment-sms-consent"));
    await user.click(screen.getByRole("button", { name: "Confirm Booking" }));

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(mutate.mock.calls[0][0].data).toMatchObject({
      smsConsent: true,
      phone: "512-555-0123",
    });
  });

  it("asks for a number rather than booking an opt-in it can't act on", async () => {
    const user = userEvent.setup();
    render(<Appointments />);

    await user.click(screen.getByTestId("type-fitting"));
    await user.click(await screen.findByTestId(`slot-${SLOT_ISO}`));
    await screen.findByTestId("step-details");
    await user.type(document.getElementById("fullName")!, "Ada Lovelace");
    await user.type(document.getElementById("email")!, "ada@example.com");
    await user.type(document.getElementById("orderNumber")!, "000123");
    // Ticked, but the phone field is empty — the server would ignore it.
    await user.click(screen.getByTestId("appointment-sms-consent"));
    await user.click(screen.getByRole("button", { name: "Confirm Booking" }));

    expect(
      await screen.findByText(
        "We need a mobile number to text you about this appointment.",
      ),
    ).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });
});
