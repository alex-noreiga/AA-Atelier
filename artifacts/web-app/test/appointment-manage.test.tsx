import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Control the query hooks + capture the mutation payloads without any network.
const { rescheduleMutate, cancelMutate, appointmentState, availabilityState } =
  vi.hoisted(() => ({
    rescheduleMutate: vi.fn(),
    cancelMutate: vi.fn(),
    appointmentState: { current: {} as Record<string, unknown> },
    availabilityState: { current: {} as Record<string, unknown> },
  }));

vi.mock("@workspace/api-client-react", () => ({
  useGetAppointment: () => appointmentState.current,
  getGetAppointmentQueryKey: () => ["appointment"],
  useGetAppointmentAvailability: () => availabilityState.current,
  getGetAppointmentAvailabilityQueryKey: () => ["availability"],
  useRescheduleAppointment: () => ({
    mutate: rescheduleMutate,
    isPending: false,
  }),
  useCancelAppointment: () => ({ mutate: cancelMutate, isPending: false }),
}));

import AppointmentManage from "@/pages/appointment-manage";

const DETAILS = {
  status: "confirmed",
  confirmationCode: "APT-XYZ",
  typeId: "consultation",
  typeName: "Consultation",
  staff: "Alayna",
  location: "in-person",
  locationLabel: "In person",
  start: "2026-07-20T10:00:00.000Z",
  end: "2026-07-20T10:30:00.000Z",
  timezone: "UTC",
  canModify: true,
};

const NEW_SLOT_ISO = "2026-07-21T09:00:00.000Z";

beforeEach(() => {
  window.history.replaceState({}, "", "/appointments/manage?token=abc");
  appointmentState.current = {
    data: DETAILS,
    isLoading: false,
    isError: false,
  };
  availabilityState.current = {
    data: {
      timezone: "UTC",
      slots: [
        {
          start: NEW_SLOT_ISO,
          end: "2026-07-21T09:30:00.000Z",
          staff: "Alayna",
        },
      ],
    },
    isLoading: false,
    isError: false,
    isSuccess: true,
  };
});

describe("Appointment manage page", () => {
  it("shows the appointment details and the manage actions", () => {
    render(<AppointmentManage />);
    expect(screen.getByText(/Consultation with Alayna/)).toBeInTheDocument();
    expect(screen.getByText("APT-XYZ")).toBeInTheDocument();
    expect(screen.getByTestId("button-reschedule")).toBeInTheDocument();
    expect(screen.getByTestId("button-cancel")).toBeInTheDocument();
  });

  it("requires a confirmation before cancelling, then sends the token", async () => {
    const user = userEvent.setup();
    render(<AppointmentManage />);

    await user.click(screen.getByTestId("button-cancel"));
    // A confirmation step appears — nothing sent yet.
    expect(screen.getByTestId("cancel-confirm")).toBeInTheDocument();
    expect(cancelMutate).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("button-confirm-cancel"));
    await waitFor(() => expect(cancelMutate).toHaveBeenCalledTimes(1));
    expect(cancelMutate.mock.calls[0][0]).toEqual({ data: { token: "abc" } });
  });

  it("reschedules to a chosen slot, sending the token + new start", async () => {
    const user = userEvent.setup();
    render(<AppointmentManage />);

    await user.click(screen.getByTestId("button-reschedule"));
    await user.click(await screen.findByTestId(`slot-${NEW_SLOT_ISO}`));

    await waitFor(() => expect(rescheduleMutate).toHaveBeenCalledTimes(1));
    expect(rescheduleMutate.mock.calls[0][0]).toEqual({
      data: { token: "abc", start: NEW_SLOT_ISO },
    });
  });

  it("shows a cancelled appointment without modify actions", () => {
    appointmentState.current = {
      data: { ...DETAILS, status: "cancelled", canModify: false },
      isLoading: false,
      isError: false,
    };
    render(<AppointmentManage />);
    expect(
      screen.getByText(/This appointment has been cancelled/),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("button-reschedule")).not.toBeInTheDocument();
  });

  it("explains when the link is invalid", () => {
    appointmentState.current = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: { data: { error: "This link is invalid or has expired." } },
    };
    render(<AppointmentManage />);
    expect(screen.getByText(/invalid or has expired/)).toBeInTheDocument();
  });
});
