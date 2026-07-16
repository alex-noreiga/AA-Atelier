import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { measurementChangeInput } from "@workspace/test-fixtures";

// Capture the mutation call and the onError handler the dialog wires up, so we
// can assert the submit payload and drive the error-render path — all without
// the network. `vi.hoisted` makes these available inside the hoisted vi.mock.
const hoisted = vi.hoisted(() => ({
  mutate: vi.fn(),
  handlers: { onError: undefined as undefined | ((e: unknown) => void) },
}));
vi.mock("@workspace/api-client-react", () => ({
  useCreateMeasurementChangeRequest: (opts: {
    mutation?: { onError?: (e: unknown) => void };
  }) => {
    hoisted.handlers.onError = opts?.mutation?.onError;
    return { mutate: hoisted.mutate, isPending: false };
  },
}));

import { MeasurementChangeDialog } from "@/components/measurement-change-dialog";

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`no element with id ${id}`);
  return el;
}

async function open(user: ReturnType<typeof userEvent.setup>) {
  render(<MeasurementChangeDialog orderNumber="000002" />);
  await user.click(
    screen.getByTestId("button-request-measurement-change"),
  );
  await screen.findByTestId("measurement-change-dialog");
}

async function fillMeasurements(
  user: ReturnType<typeof userEvent.setup>,
  email: string,
) {
  const input = measurementChangeInput();
  await user.type(byId("mc-email"), email);
  await user.type(byId("mc-waist"), String(input.waist));
  await user.type(byId("mc-bust"), String(input.bust));
  await user.type(byId("mc-hips"), String(input.hips));
  await user.type(byId("mc-height"), String(input.height));
  await user.type(byId("mc-bodyGirth"), String(input.bodyGirth));
}

afterEach(() => {
  hoisted.handlers.onError = undefined;
});

describe("MeasurementChangeDialog submission mapping", () => {
  it("sends the orderNumber and coerced measurements, omitting an empty note", async () => {
    const user = userEvent.setup();
    await open(user);
    await fillMeasurements(user, "ada@example.com");
    await user.click(screen.getByTestId("measurement-change-submit"));

    await waitFor(() => expect(hoisted.mutate).toHaveBeenCalledTimes(1));
    const arg = hoisted.mutate.mock.calls[0][0];
    expect(arg.orderNumber).toBe("000002");
    expect(arg.data).not.toHaveProperty("note");
    expect(arg.data).toMatchObject({
      email: "ada@example.com",
      measurementUnit: "inches",
      waist: 29,
      bodyGirth: 33,
    });
  });

  it("includes the note when provided", async () => {
    const user = userEvent.setup();
    await open(user);
    await fillMeasurements(user, "ada@example.com");
    await user.type(byId("mc-note"), "Waist a touch bigger");
    await user.click(screen.getByTestId("measurement-change-submit"));

    await waitFor(() => expect(hoisted.mutate).toHaveBeenCalledTimes(1));
    expect(hoisted.mutate.mock.calls[0][0].data.note).toBe(
      "Waist a touch bigger",
    );
  });

  it("flags an appointment and omits measurements in appointment mode", async () => {
    const user = userEvent.setup();
    await open(user);
    await user.type(byId("mc-email"), "ada@example.com");
    await user.click(screen.getByTestId("measurement-change-mode-appointment"));
    // The measurement inputs are gone in appointment mode.
    expect(document.getElementById("mc-waist")).toBeNull();

    // The re-measure panel links straight to booking a fitting.
    expect(
      screen.getByTestId("measurement-change-book-fitting"),
    ).toHaveAttribute("href", "/appointments?type=fitting");

    await user.click(screen.getByTestId("measurement-change-submit"));

    await waitFor(() => expect(hoisted.mutate).toHaveBeenCalledTimes(1));
    const arg = hoisted.mutate.mock.calls[0][0];
    expect(arg.data.measurementAppointment).toBe(true);
    expect(arg.data).not.toHaveProperty("waist");
    expect(arg.data).not.toHaveProperty("measurementUnit");
  });
});

describe("MeasurementChangeDialog validation & errors", () => {
  it("blocks submission and shows a message for an invalid email", async () => {
    const user = userEvent.setup();
    await open(user);
    fireEvent.change(byId("mc-email"), { target: { value: "nope" } });
    await user.click(screen.getByTestId("measurement-change-submit"));

    expect(
      await screen.findByText("Please enter a valid email address"),
    ).toBeInTheDocument();
    expect(hoisted.mutate).not.toHaveBeenCalled();
  });

  it("surfaces a 403/409 error inline in the form", async () => {
    const user = userEvent.setup();
    await open(user);

    act(() => {
      hoisted.handlers.onError?.({
        status: 403,
        data: { error: "That email doesn't match the one on this order." },
      });
    });

    expect(
      await screen.findByTestId("measurement-change-error"),
    ).toHaveTextContent("That email doesn't match the one on this order.");
  });
});
