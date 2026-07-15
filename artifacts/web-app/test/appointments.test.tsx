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
    },
    {
      id: "fitting",
      name: "Fitting & Measurements",
      durationMinutes: 60,
      description: "In person only.",
      staff: ["Alexandra"],
      locations: ["in-person"],
    },
  ],
};

const SLOT_ISO = "2026-07-20T09:00:00.000Z";

beforeEach(() => {
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
    await user.click(screen.getByRole("button", { name: "Confirm Booking" }));

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    const { data } = mutate.mock.calls[0][0];
    expect(data).toMatchObject({
      typeId: "consultation",
      location: "in-person",
      start: SLOT_ISO,
      fullName: "Ada Lovelace",
      email: "ada@example.com",
    });
    expect(data).not.toHaveProperty("staff");
  });
});
