// The working-hours editor. The generated hooks are mocked, so what's tested is
// the panel's own job: reading the stored schedule back the way it will actually
// be applied, sending a well-formed entry, and showing the server's refusal
// verbatim when it sends one.
//
// The refusal case is the point of the whole feature: the Google Sheet this
// replaced accepted anything and silently offered no hours for it.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Mock } from "vitest";

const h = vi.hoisted(() => ({
  list: {
    data: undefined as unknown,
    isLoading: false,
    isError: false,
    error: null as unknown,
  },
  create: { mutate: vi.fn(), isPending: false },
  update: { mutate: vi.fn(), isPending: false },
  remove: { mutate: vi.fn(), isPending: false },
  invalidate: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  useListStaffAvailability: () => h.list,
  useCreateStaffAvailability: () => h.create,
  useUpdateStaffAvailability: () => h.update,
  useDeleteStaffAvailability: () => h.remove,
  getListStaffAvailabilityQueryKey: () => ["/api/studio/availability"],
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: h.invalidate }),
}));

import { StudioAvailability } from "@/components/studio-availability";

const createMutate = h.create.mutate as unknown as Mock;
const updateMutate = h.update.mutate as unknown as Mock;
const removeMutate = h.remove.mutate as unknown as Mock;

const ENTRY = {
  id: "row-1",
  staff: "Alexandra",
  calendarEmail: "alexandra@atelier.test",
  weekdays: ["Monday", "Tuesday", "Wednesday"],
  start: "10:00",
  end: "17:00",
  locations: ["in-person"],
};

function schedule(entries: unknown[], staff = ["Alayna", "Alexandra"]) {
  h.list.data = { entries, staff };
}

beforeEach(() => {
  h.list = { data: undefined, isLoading: false, isError: false, error: null };
  h.create.isPending = false;
  h.update.isPending = false;
  h.remove.isPending = false;
  createMutate.mockReset();
  updateMutate.mockReset();
  removeMutate.mockReset();
  schedule([]);
});

describe("StudioAvailability", () => {
  it("says plainly when no hours are set, since that means no bookings", () => {
    render(<StudioAvailability />);
    expect(screen.getByTestId("availability-empty")).toHaveTextContent(
      /no appointment times are being offered/i,
    );
  });

  it("groups a person's hours and summarizes a consecutive run of days", () => {
    schedule([ENTRY]);
    render(<StudioAvailability />);

    expect(
      screen.getByTestId("availability-staff-Alexandra"),
    ).toBeInTheDocument();
    const row = screen.getByTestId("availability-entry-row-1");
    expect(row).toHaveTextContent("Mon–Wed");
    expect(row).toHaveTextContent("10:00–17:00");
    expect(row).toHaveTextContent("In person");
  });

  it("flags hours left behind by someone the studio no longer books", () => {
    schedule([{ ...ENTRY, staff: "Former" }]);
    render(<StudioAvailability />);
    expect(
      screen.getByTestId("availability-staff-unassigned"),
    ).toHaveTextContent(/nothing can be booked into them/i);
  });

  it("sends a new block of hours as the contract expects", async () => {
    const user = userEvent.setup();
    render(<StudioAvailability />);

    await user.click(screen.getByTestId("availability-add"));
    await user.type(
      screen.getByTestId("availability-new-email"),
      "alayna@atelier.test",
    );
    await user.click(screen.getByTestId("availability-new-day-wednesday"));
    await user.click(screen.getByTestId("availability-new-location-virtual"));
    await user.click(screen.getByTestId("availability-new-save"));

    expect(createMutate).toHaveBeenCalledTimes(1);
    expect(createMutate.mock.calls[0][0]).toEqual({
      data: {
        staff: "Alayna",
        calendarEmail: "alayna@atelier.test",
        weekdays: ["Monday", "Wednesday"],
        start: "10:00",
        end: "17:00",
        locations: ["in-person", "virtual"],
      },
    });
  });

  it("won't submit an entry with no days left on it", async () => {
    const user = userEvent.setup();
    render(<StudioAvailability />);

    await user.click(screen.getByTestId("availability-add"));
    await user.type(
      screen.getByTestId("availability-new-email"),
      "alayna@atelier.test",
    );
    await user.click(screen.getByTestId("availability-new-day-monday"));

    expect(screen.getByTestId("availability-new-save")).toBeDisabled();
    expect(createMutate).not.toHaveBeenCalled();
  });

  it("shows the server's reason when it refuses the entry", async () => {
    const user = userEvent.setup();
    createMutate.mockImplementation((_vars, opts) =>
      opts.onError({
        data: { error: "The end time must be after the start time." },
      }),
    );
    render(<StudioAvailability />);

    await user.click(screen.getByTestId("availability-add"));
    await user.type(
      screen.getByTestId("availability-new-email"),
      "alayna@atelier.test",
    );
    await user.click(screen.getByTestId("availability-new-save"));

    expect(screen.getByTestId("availability-new-error")).toHaveTextContent(
      "The end time must be after the start time.",
    );
  });

  it("edits an existing block in place", async () => {
    const user = userEvent.setup();
    schedule([ENTRY]);
    updateMutate.mockImplementation((_vars, opts) => opts.onSuccess());
    render(<StudioAvailability />);

    await user.click(screen.getByTestId("availability-edit-row-1"));
    await user.click(screen.getByTestId("availability-row-1-day-thursday"));
    await user.click(screen.getByTestId("availability-row-1-save"));

    expect(updateMutate.mock.calls[0][0]).toMatchObject({
      entryId: "row-1",
      data: {
        weekdays: ["Monday", "Tuesday", "Wednesday", "Thursday"],
      },
    });
    expect(h.invalidate).toHaveBeenCalled();
  });

  it("asks before removing hours, then removes them", async () => {
    const user = userEvent.setup();
    schedule([ENTRY]);
    removeMutate.mockImplementation((_vars, opts) => opts.onSuccess());
    render(<StudioAvailability />);

    await user.click(screen.getByTestId("availability-remove-row-1"));
    expect(removeMutate).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("availability-remove-confirm-row-1"));
    expect(removeMutate.mock.calls[0][0]).toEqual({ entryId: "row-1" });
  });
});
