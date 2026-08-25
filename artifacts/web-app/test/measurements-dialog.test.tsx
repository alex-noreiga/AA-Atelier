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

// Capture both mutations' calls and the onError/onSuccess handlers the dialog
// wires up, so we can assert which endpoint each mode drives, the submit
// payload, and the render of every outcome — all without the network.
// `vi.hoisted` makes these available inside the hoisted vi.mock.
const hoisted = vi.hoisted(() => ({
  update: vi.fn(),
  request: vi.fn(),
  handlers: {
    onError: undefined as undefined | ((e: unknown) => void),
    onUpdated: undefined as undefined | ((d: unknown) => void),
  },
}));
vi.mock("@workspace/api-client-react", () => ({
  useUpdateOrderMeasurements: (opts: {
    mutation?: {
      onError?: (e: unknown) => void;
      onSuccess?: (d: unknown) => void;
    };
  }) => {
    hoisted.handlers.onError = opts?.mutation?.onError;
    hoisted.handlers.onUpdated = opts?.mutation?.onSuccess;
    return { mutate: hoisted.update, isPending: false };
  },
  useCreateMeasurementChangeRequest: (opts: {
    mutation?: { onError?: (e: unknown) => void };
  }) => {
    hoisted.handlers.onError = opts?.mutation?.onError;
    return { mutate: hoisted.request, isPending: false };
  },
}));

import { MeasurementsDialog } from "@/components/measurements-dialog";

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`no element with id ${id}`);
  return el;
}

async function open(user: ReturnType<typeof userEvent.setup>) {
  render(<MeasurementsDialog orderNumber="000002" />);
  await user.click(screen.getByTestId("button-update-measurements"));
  await screen.findByTestId("measurements-dialog");
}

async function fillMeasurements(
  user: ReturnType<typeof userEvent.setup>,
  email: string,
) {
  const input = measurementChangeInput();
  await user.type(byId("mc-email"), email);
  await user.type(byId("measurements-waist"), String(input.waist));
  await user.type(byId("measurements-bust"), String(input.bust));
  await user.type(byId("measurements-hips"), String(input.hips));
  await user.type(byId("measurements-height"), String(input.height));
  await user.type(byId("measurements-bodyGirth"), String(input.bodyGirth));
}

afterEach(() => {
  hoisted.handlers.onError = undefined;
  hoisted.handlers.onUpdated = undefined;
});

describe("MeasurementsDialog submission mapping", () => {
  it("writes the measurements in place, omitting an empty note", async () => {
    const user = userEvent.setup();
    await open(user);
    await fillMeasurements(user, "ada@example.com");
    await user.click(screen.getByTestId("measurements-submit"));

    await waitFor(() => expect(hoisted.update).toHaveBeenCalledTimes(1));
    // The values branch edits the order; nothing is filed for a human.
    expect(hoisted.request).not.toHaveBeenCalled();
    const arg = hoisted.update.mock.calls[0][0];
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
    await user.click(screen.getByTestId("measurements-submit"));

    await waitFor(() => expect(hoisted.update).toHaveBeenCalledTimes(1));
    expect(hoisted.update.mock.calls[0][0].data.note).toBe(
      "Waist a touch bigger",
    );
  });

  it("files a change request in appointment mode, never editing the order", async () => {
    const user = userEvent.setup();
    await open(user);
    await user.type(byId("mc-email"), "ada@example.com");
    await user.click(screen.getByTestId("measurements-mode-appointment"));
    // The measurement inputs are gone in appointment mode.
    expect(document.getElementById("measurements-waist")).toBeNull();

    // The re-measure panel links straight to booking a fitting.
    expect(screen.getByTestId("measurements-book-fitting")).toHaveAttribute(
      "href",
      "/appointments?type=fitting",
    );

    await user.click(screen.getByTestId("measurements-submit"));

    await waitFor(() => expect(hoisted.request).toHaveBeenCalledTimes(1));
    // Asking to be re-measured is a request for a service, not a value change,
    // so it must never take the in-place write path.
    expect(hoisted.update).not.toHaveBeenCalled();
    const arg = hoisted.request.mock.calls[0][0];
    expect(arg.data.measurementAppointment).toBe(true);
    expect(arg.data).not.toHaveProperty("waist");
    expect(arg.data).not.toHaveProperty("measurementUnit");
  });

  it("sends the picked unit with the values", async () => {
    const user = userEvent.setup();
    await open(user);
    await fillMeasurements(user, "ada@example.com");
    await user.click(screen.getByTestId("measurements-unit-cm"));
    await user.click(screen.getByTestId("measurements-submit"));

    await waitFor(() => expect(hoisted.update).toHaveBeenCalledTimes(1));
    expect(hoisted.update.mock.calls[0][0].data.measurementUnit).toBe("cm");
  });
});

describe("MeasurementsDialog outcomes", () => {
  it("says the measurements are on the order when the server applied them", async () => {
    const user = userEvent.setup();
    await open(user);

    act(() => hoisted.handlers.onUpdated?.({ outcome: "applied" }));

    expect(await screen.findByTestId("measurements-success")).toHaveTextContent(
      "Measurements updated",
    );
  });

  it("says the edit went to the atelier when the server could only file it", async () => {
    const user = userEvent.setup();
    await open(user);

    // The server couldn't write to the order (a legacy order with no email to
    // verify against, or a database missing the properties) and filed the
    // values instead. The customer must be told which happened — claiming a
    // save here would have them believe numbers are in force that aren't.
    act(() => hoisted.handlers.onUpdated?.({ outcome: "filed" }));

    const success = await screen.findByTestId("measurements-success");
    expect(success).toHaveTextContent("Request received");
    expect(success).toHaveTextContent(
      "passed your measurements to the atelier",
    );
  });
});

describe("MeasurementsDialog validation & errors", () => {
  it("blocks submission and shows a message for an invalid email", async () => {
    const user = userEvent.setup();
    await open(user);
    fireEvent.change(byId("mc-email"), { target: { value: "nope" } });
    await user.click(screen.getByTestId("measurements-submit"));

    expect(
      await screen.findByText("Please enter a valid email address"),
    ).toBeInTheDocument();
    expect(hoisted.update).not.toHaveBeenCalled();
  });

  it("refuses a blank measurement rather than sending it as zero", async () => {
    const user = userEvent.setup();
    await open(user);
    await user.type(byId("mc-email"), "ada@example.com");
    // Every value but the waist — `Number("")` is 0, not NaN, so a blank field
    // is exactly the input that could reach the server as a real measurement.
    await user.type(byId("measurements-bust"), "34");
    await user.type(byId("measurements-hips"), "36");
    await user.type(byId("measurements-height"), "64");
    await user.type(byId("measurements-bodyGirth"), "33");
    await user.click(screen.getByTestId("measurements-submit"));

    expect(await screen.findByText("Required")).toBeInTheDocument();
    expect(hoisted.update).not.toHaveBeenCalled();
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

    expect(await screen.findByTestId("measurements-error")).toHaveTextContent(
      "That email doesn't match the one on this order.",
    );
  });
});
