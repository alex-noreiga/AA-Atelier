// The studio settings editor. The generated hooks are mocked, so what's tested
// is the panel's own job — which is not "show a table of values" (Notion already
// does that) but answer the two questions a free-text key/value table can't:
// what is actually in force and where it came from, and which rows aren't
// settings at all.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Mock } from "vitest";

const h = vi.hoisted(() => ({
  settings: {
    data: undefined as unknown,
    isLoading: false,
    isError: false,
    error: null as unknown,
  },
  save: { mutate: vi.fn(), isPending: false },
  invalidate: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetStudioSettings: () => h.settings,
  useSetStudioSetting: () => h.save,
  getGetStudioSettingsQueryKey: () => ["/api/studio/settings"],
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: h.invalidate }),
}));

import { StudioSettings } from "@/components/studio-settings";

const saveMutate = h.save.mutate as unknown as Mock;

function setting(overrides: Record<string, unknown> = {}) {
  return {
    key: "RUSH_SURCHARGE_RATE",
    label: "Rush surcharge",
    group: "Orders & pricing",
    kind: "number",
    description: "The fraction added as a rush surcharge line.",
    defaultValue: "0.15",
    effectiveValue: "0.15",
    source: "default",
    min: 0,
    max: 1,
    step: 0.01,
    ...overrides,
  };
}

function overview(overrides: Record<string, unknown> = {}) {
  return {
    configured: true,
    settings: [setting()],
    unknownRows: [],
    ...overrides,
  };
}

beforeEach(() => {
  h.settings = {
    data: overview(),
    isLoading: false,
    isError: false,
    error: null,
  };
  // Reset rather than replace: `saveMutate` below is bound to this exact mock.
  saveMutate.mockReset();
  h.save.isPending = false;
});

describe("StudioSettings", () => {
  it("shows a spinner while loading", () => {
    h.settings = {
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
    };
    render(<StudioSettings />);
    expect(screen.getByTestId("settings-loading")).toBeInTheDocument();
  });

  it("shows the server's message when the read fails", () => {
    h.settings = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: { data: { error: "Nope." } },
    };
    render(<StudioSettings />);
    expect(screen.getByTestId("settings-error")).toHaveTextContent("Nope.");
  });

  it("names where each effective value came from", () => {
    h.settings.data = overview({
      settings: [
        setting({
          source: "notion",
          effectiveValue: "0.2",
          notionValue: "0.2",
        }),
      ],
    });
    render(<StudioSettings />);
    expect(
      screen.getByTestId("setting-source-RUSH_SURCHARGE_RATE"),
    ).toHaveTextContent("Notion");
    expect(
      screen.getByTestId("setting-effective-RUSH_SURCHARGE_RATE"),
    ).toHaveTextContent("0.2");
  });

  it("calls out a configured value the app is ignoring", () => {
    // The failure the whole panel exists for: in Notion this row looks entirely
    // normal, and the app has been using the default all along.
    h.settings.data = overview({
      settings: [
        setting({
          source: "default",
          effectiveValue: "0.15",
          notionValue: "fifteen percent",
          ignoredValue: "fifteen percent",
        }),
      ],
    });
    render(<StudioSettings />);
    const warning = screen.getByTestId("setting-ignored-RUSH_SURCHARGE_RATE");
    expect(warning).toHaveTextContent("fifteen percent");
    expect(warning).toHaveTextContent(/default is being used/i);
  });

  it("lists a row that isn't a setting, with what it was probably meant to be", () => {
    h.settings.data = overview({
      unknownRows: [
        {
          key: "APPOINTMENT_TIMEZON",
          value: "Europe/London",
          suggestion: "APPOINTMENT_TIMEZONE",
        },
      ],
    });
    render(<StudioSettings />);
    const row = screen.getByTestId("settings-unknown-APPOINTMENT_TIMEZON");
    expect(row).toHaveTextContent("APPOINTMENT_TIMEZON");
    expect(row).toHaveTextContent("APPOINTMENT_TIMEZONE");
  });

  it("seeds the field from the Notion value, not the effective one", async () => {
    // An environment value shown in an editable box would be copied into Notion
    // the moment anyone pressed Save, silently moving where the setting lives.
    h.settings.data = overview({
      settings: [
        setting({
          source: "environment",
          effectiveValue: "0.25",
          envValue: "0.25",
        }),
      ],
    });
    render(<StudioSettings />);
    expect(screen.getByTestId("setting-field-RUSH_SURCHARGE_RATE")).toHaveValue(
      null,
    );
  });

  it("saves an edited value", async () => {
    const user = userEvent.setup();
    render(<StudioSettings />);

    await user.type(
      screen.getByTestId("setting-field-RUSH_SURCHARGE_RATE"),
      "0.2",
    );
    await user.click(screen.getByTestId("setting-save-RUSH_SURCHARGE_RATE"));

    expect(saveMutate).toHaveBeenCalledWith(
      { key: "RUSH_SURCHARGE_RATE", data: { value: "0.2" } },
      expect.anything(),
    );
  });

  it("shows the server's refusal verbatim", async () => {
    const user = userEvent.setup();
    saveMutate.mockImplementation(
      (_vars: unknown, handlers: { onError: (error: unknown) => void }) =>
        handlers.onError({
          data: { error: "That has to be between 0 and 1." },
        }),
    );
    render(<StudioSettings />);

    await user.type(
      screen.getByTestId("setting-field-RUSH_SURCHARGE_RATE"),
      "15",
    );
    await user.click(screen.getByTestId("setting-save-RUSH_SURCHARGE_RATE"));

    expect(
      screen.getByTestId("setting-error-RUSH_SURCHARGE_RATE"),
    ).toHaveTextContent("That has to be between 0 and 1.");
  });

  it("offers no Clear when there's nothing stored to clear", () => {
    render(<StudioSettings />);
    expect(
      screen.queryByTestId("setting-clear-RUSH_SURCHARGE_RATE"),
    ).not.toBeInTheDocument();
  });

  it("clears a stored setting with an empty value", async () => {
    const user = userEvent.setup();
    h.settings.data = overview({
      settings: [
        setting({
          source: "notion",
          effectiveValue: "0.2",
          notionValue: "0.2",
        }),
      ],
    });
    render(<StudioSettings />);
    await user.click(screen.getByTestId("setting-clear-RUSH_SURCHARGE_RATE"));

    expect(saveMutate).toHaveBeenCalledWith(
      { key: "RUSH_SURCHARGE_RATE", data: { value: "" } },
      expect.anything(),
    );
  });

  it("says plainly when there's no settings database, and offers no editor", () => {
    h.settings.data = overview({ configured: false });
    render(<StudioSettings />);
    expect(screen.getByTestId("settings-unconfigured")).toBeInTheDocument();
    expect(
      screen.queryByTestId("setting-field-RUSH_SURCHARGE_RATE"),
    ).not.toBeInTheDocument();
    // The values are still shown — they're the environment's and the built-ins'.
    expect(
      screen.getByTestId("setting-effective-RUSH_SURCHARGE_RATE"),
    ).toHaveTextContent("0.15");
  });
});
