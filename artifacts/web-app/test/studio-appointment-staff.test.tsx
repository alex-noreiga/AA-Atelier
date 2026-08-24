// The appointment-staffing panel. The generated hooks are mocked, so what's
// tested is the panel's own job: reading the staffing back the way it is
// actually in force, refusing to send a type with nobody on it, sending roster
// order (which is what decides who takes a no-preference slot), and showing the
// server's refusal verbatim.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Mock } from "vitest";

const h = vi.hoisted(() => ({
  read: {
    data: undefined as unknown,
    isLoading: false,
    isError: false,
    error: null as unknown,
  },
  save: { mutate: vi.fn(), isPending: false },
  invalidate: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetAppointmentStaffing: () => h.read,
  useSetAppointmentStaffing: () => h.save,
  getGetAppointmentStaffingQueryKey: () => ["/api/studio/appointment-staff"],
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: h.invalidate }),
}));

import { StudioAppointmentStaff } from "@/components/studio-appointment-staff";

const saveMutate = h.save.mutate as unknown as Mock;

const CONSULTATION = {
  id: "consultation",
  name: "Consultation",
  description: "Talk through ideas for a new custom piece.",
  durationMinutes: 30,
  locations: ["in-person", "virtual"],
  staff: ["Alayna"],
  defaultStaff: ["Alayna"],
};

const FITTING = {
  id: "fitting",
  name: "Fitting & Measurements",
  description: "Have your measurements taken.",
  durationMinutes: 60,
  locations: ["in-person"],
  staff: ["Alexandra", "Alayna"],
  defaultStaff: ["Alexandra", "Alayna"],
  requiresOrder: true,
};

function staffing(
  types: unknown[] = [CONSULTATION, FITTING],
  overrides: Record<string, unknown> = {},
) {
  h.read.data = {
    configured: true,
    staff: ["Alexandra", "Alayna"],
    types,
    usingDefaults: true,
    ...overrides,
  };
}

beforeEach(() => {
  h.read = { data: undefined, isLoading: false, isError: false, error: null };
  h.save = { mutate: saveMutate, isPending: false };
  staffing();
});

describe("StudioAppointmentStaff", () => {
  it("shows each type with the people currently on it", () => {
    render(<StudioAppointmentStaff />);

    expect(
      screen.getByTestId("appointment-staff-consultation-alayna"),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByTestId("appointment-staff-consultation-alexandra"),
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.getByTestId("appointment-staff-fitting-alexandra"),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("marks a type that has been moved off the studio's usual staffing", () => {
    staffing([{ ...CONSULTATION, staff: ["Alexandra"] }, FITTING], {
      usingDefaults: false,
    });
    render(<StudioAppointmentStaff />);

    expect(
      screen.getByTestId("appointment-staff-moved-consultation"),
    ).toHaveTextContent("Alayna");
    expect(screen.queryByTestId("appointment-staff-moved-fitting")).toBeNull();
  });

  it("sends every type, in roster order, when saved", async () => {
    render(<StudioAppointmentStaff />);
    await userEvent.click(
      screen.getByTestId("appointment-staff-consultation-alexandra"),
    );
    await userEvent.click(screen.getByTestId("appointment-staff-save"));

    expect(saveMutate).toHaveBeenCalledTimes(1);
    expect(saveMutate.mock.calls[0][0]).toEqual({
      data: {
        types: [
          // Roster order, not click order — it decides who takes a slot booked
          // with no staff preference.
          { id: "consultation", staff: ["Alexandra", "Alayna"] },
          { id: "fitting", staff: ["Alexandra", "Alayna"] },
        ],
      },
    });
  });

  it("won't save while a type has nobody on it, and says why", async () => {
    render(<StudioAppointmentStaff />);
    await userEvent.click(
      screen.getByTestId("appointment-staff-consultation-alayna"),
    );

    expect(
      screen.getByTestId("appointment-staff-empty-consultation"),
    ).toHaveTextContent(/no times will be offered/i);
    expect(screen.getByTestId("appointment-staff-save")).toBeDisabled();
    expect(saveMutate).not.toHaveBeenCalled();
  });

  it("keeps Save disabled until something actually changes", async () => {
    render(<StudioAppointmentStaff />);
    expect(screen.getByTestId("appointment-staff-save")).toBeDisabled();

    await userEvent.click(
      screen.getByTestId("appointment-staff-fitting-alayna"),
    );
    expect(screen.getByTestId("appointment-staff-save")).toBeEnabled();
  });

  it("lets a person be taken off everything — that's a season off, not an error", async () => {
    render(<StudioAppointmentStaff />);
    await userEvent.click(
      screen.getByTestId("appointment-staff-fitting-alexandra"),
    );

    expect(screen.queryByTestId("appointment-staff-empty-fitting")).toBeNull();
    await userEvent.click(screen.getByTestId("appointment-staff-save"));
    expect(saveMutate.mock.calls[0][0].data.types).toEqual([
      { id: "consultation", staff: ["Alayna"] },
      { id: "fitting", staff: ["Alayna"] },
    ]);
  });

  it("puts the studio's usual staffing back", async () => {
    staffing([{ ...CONSULTATION, staff: ["Alexandra"] }, FITTING], {
      usingDefaults: false,
    });
    render(<StudioAppointmentStaff />);
    await userEvent.click(screen.getByTestId("appointment-staff-reset"));

    expect(
      screen.getByTestId("appointment-staff-consultation-alayna"),
    ).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByTestId("appointment-staff-save"));
    expect(saveMutate.mock.calls[0][0].data.types[0]).toEqual({
      id: "consultation",
      staff: ["Alayna"],
    });
  });

  it("shows the server's refusal verbatim", async () => {
    saveMutate.mockImplementation(
      (_vars: unknown, handlers: { onError: (err: unknown) => void }) =>
        handlers.onError({
          status: 400,
          data: { error: '"Marguerite" isn\'t someone the studio books.' },
        }),
    );
    render(<StudioAppointmentStaff />);
    await userEvent.click(
      screen.getByTestId("appointment-staff-consultation-alexandra"),
    );
    await userEvent.click(screen.getByTestId("appointment-staff-save"));

    expect(
      screen.getByTestId("appointment-staff-save-error"),
    ).toHaveTextContent("Marguerite");
  });

  it("says plainly when there is nowhere to write, instead of offering a Save", () => {
    staffing(undefined, { configured: false });
    render(<StudioAppointmentStaff />);

    expect(screen.getByTestId("appointment-staff-unconfigured")).toBeVisible();
    expect(screen.queryByTestId("appointment-staff-save")).toBeNull();
    expect(
      screen.getByTestId("appointment-staff-consultation-alayna"),
    ).toBeDisabled();
  });

  it("reports a failed read rather than an empty grid", () => {
    h.read = { data: undefined, isLoading: false, isError: true, error: null };
    render(<StudioAppointmentStaff />);

    expect(screen.getByTestId("appointment-staff-error")).toBeVisible();
    expect(screen.queryByTestId("appointment-staff-save")).toBeNull();
  });
});
