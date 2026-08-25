import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Both generated hooks are mocked so the panel can be driven through every
// state — a partial export, a failed one, a repeat deletion request — without a
// network or a query client.
const hoisted = vi.hoisted(() => ({
  refetch: vi.fn(),
  isFetching: false,
  mutate: vi.fn(),
  deletion: {
    data: undefined as unknown,
    isPending: false,
    isError: false,
    error: null as unknown,
  },
}));

vi.mock("@workspace/api-client-react", () => ({
  getExportAccountDataQueryKey: () => ["exportAccountData"],
  useExportAccountData: () => ({
    refetch: hoisted.refetch,
    isFetching: hoisted.isFetching,
  }),
  useRequestAccountDeletion: () => ({
    mutate: hoisted.mutate,
    ...hoisted.deletion,
  }),
}));

import { AccountData } from "@/components/account-data";

const EXPORT = {
  generatedAt: "2026-08-24T10:00:00.000Z",
  email: "ada@example.com",
  customOrders: [],
  shopOrders: [],
  appointments: [],
  requests: [],
  reviews: [],
  marketing: { status: "absent" },
  unavailable: [] as string[],
};

beforeEach(() => {
  hoisted.isFetching = false;
  hoisted.deletion = {
    data: undefined,
    isPending: false,
    isError: false,
    error: null,
  };
  hoisted.refetch.mockResolvedValue({ data: EXPORT, error: null });
});

describe("AccountData — the export", () => {
  it("fetches on the press, not on render", async () => {
    const user = userEvent.setup();
    render(<AccountData />);

    expect(hoisted.refetch).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("button-export-data"));
    expect(hoisted.refetch).toHaveBeenCalledTimes(1);
    await screen.findByTestId("export-message");
  });

  it("names what a partial export is missing rather than passing it off as complete", async () => {
    hoisted.refetch.mockResolvedValue({
      data: { ...EXPORT, unavailable: ["Reviews you've written"] },
      error: null,
    });
    const user = userEvent.setup();
    render(<AccountData />);

    await user.click(screen.getByTestId("button-export-data"));

    const notice = await screen.findByTestId("export-unavailable");
    expect(notice.textContent).toContain("Reviews you've written");
  });

  it("says nothing about missing sources on a complete export", async () => {
    const user = userEvent.setup();
    render(<AccountData />);

    await user.click(screen.getByTestId("button-export-data"));

    await screen.findByTestId("export-message");
    expect(screen.queryByTestId("export-unavailable")).toBeNull();
  });

  it("shows the server's own message when the export fails", async () => {
    hoisted.refetch.mockResolvedValue({
      data: undefined,
      error: { data: { error: "Notion is unavailable." } },
    });
    const user = userEvent.setup();
    render(<AccountData />);

    await user.click(screen.getByTestId("button-export-data"));

    const message = await screen.findByTestId("export-message");
    expect(message.textContent).toBe("Notion is unavailable.");
  });
});

describe("AccountData — the deletion request", () => {
  it("asks again before filing anything", async () => {
    const user = userEvent.setup();
    render(<AccountData />);

    await user.click(screen.getByTestId("button-request-deletion"));
    expect(hoisted.mutate).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("button-confirm-deletion"));
    expect(hoisted.mutate).toHaveBeenCalledWith({ data: {} });
  });

  it("sends a note when the customer wrote one, and omits it when blank", async () => {
    const user = userEvent.setup();
    render(<AccountData />);

    await user.click(screen.getByTestId("button-request-deletion"));
    await user.type(screen.getByTestId("deletion-note"), "  Finish ORD-1.  ");
    await user.click(screen.getByTestId("button-confirm-deletion"));

    expect(hoisted.mutate).toHaveBeenCalledWith({
      data: { note: "Finish ORD-1." },
    });
  });

  it("backs out without filing", async () => {
    const user = userEvent.setup();
    render(<AccountData />);

    await user.click(screen.getByTestId("button-request-deletion"));
    await user.click(screen.getByTestId("button-cancel-deletion"));

    await waitFor(() =>
      expect(screen.getByTestId("button-request-deletion")).toBeTruthy(),
    );
    expect(hoisted.mutate).not.toHaveBeenCalled();
  });

  it("confirms what happened to the mailing list", async () => {
    hoisted.deletion.data = {
      received: true,
      alreadyRequested: false,
      marketing: "unsubscribed",
    };
    render(<AccountData />);

    const filed = screen.getByTestId("deletion-filed");
    expect(filed.textContent).toContain("Your deletion request is with us");
    expect(filed.textContent).toContain("taken off our mailing list already");
  });

  it("says a repeat press found the request already on file", async () => {
    hoisted.deletion.data = {
      received: true,
      alreadyRequested: true,
      marketing: "absent",
    };
    render(<AccountData />);

    expect(screen.getByTestId("deletion-filed").textContent).toContain(
      "already with us",
    );
  });

  it("promises the opt-out rather than claiming it when Resend was unreachable", async () => {
    hoisted.deletion.data = {
      received: true,
      alreadyRequested: false,
      marketing: "unavailable",
    };
    render(<AccountData />);

    expect(screen.getByTestId("deletion-filed").textContent).toContain(
      "We'll take you off our mailing list as part of this.",
    );
  });

  it("shows the server's message when filing fails", async () => {
    hoisted.deletion.isError = true;
    hoisted.deletion.error = { data: { error: "Notion is unavailable." } };
    const user = userEvent.setup();
    render(<AccountData />);

    await user.click(screen.getByTestId("button-request-deletion"));

    expect(screen.getByTestId("deletion-error").textContent).toBe(
      "Notion is unavailable.",
    );
  });
});
