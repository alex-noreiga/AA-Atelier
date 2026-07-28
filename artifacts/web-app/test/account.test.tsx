import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { stubHook } from "./support/mock-hook.js";

// Render <Redirect> as a marker so the unauthenticated bounce is assertable.
vi.mock("wouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("wouter")>();
  return {
    ...actual,
    Redirect: ({ to }: { to: string }) => (
      <div data-testid="redirect">{to}</div>
    ),
    useLocation: () => ["/account", vi.fn()],
  };
});

vi.mock("@workspace/api-client-react", () => ({
  useGetAccountOverview: vi.fn(),
  useLogoutAccount: vi.fn(),
  getGetAccountOverviewQueryKey: () => ["account-overview"],
}));

import {
  useGetAccountOverview,
  useLogoutAccount,
} from "@workspace/api-client-react";
import Account from "@/pages/account";

const mockOverview = vi.mocked(useGetAccountOverview);
const mockLogout = vi.mocked(useLogoutAccount);
const logoutMutate = vi.fn();

function renderPage() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <Account />
    </QueryClientProvider>,
  );
}

const overview = {
  email: "skater@example.com",
  customOrders: [
    {
      orderNumber: "000002",
      orderName: "Ada – Custom Dress",
      currentStage: "Sewing",
      stages: ["Consultation", "Sewing", "Delivery"],
      estimatedCompletion: "2026-08-01",
    },
  ],
  shopOrders: [
    { orderNumber: "SHP-ABC-1234", status: "Payment Confirmed", total: 42 },
  ],
};

beforeEach(() => {
  logoutMutate.mockReset();
  mockLogout.mockReturnValue({
    mutate: logoutMutate,
    isPending: false,
  } as never);
});

describe("Account dashboard", () => {
  it("shows the loading state", () => {
    stubHook(mockOverview, { isLoading: true });
    renderPage();
    expect(screen.getByTestId("account-loading")).toBeInTheDocument();
  });

  it("redirects to sign-in on a 401", () => {
    stubHook(mockOverview, { isError: true, error: { status: 401 } });
    renderPage();
    expect(screen.getByTestId("redirect")).toHaveTextContent("/account/login");
  });

  it("shows an error state on a non-auth failure", () => {
    stubHook(mockOverview, { isError: true, error: { status: 500 } });
    renderPage();
    expect(screen.getByTestId("account-error")).toBeInTheDocument();
  });

  it("renders the customer's custom and shop orders", () => {
    stubHook(mockOverview, { data: overview });
    renderPage();

    expect(screen.getByText("skater@example.com")).toBeInTheDocument();
    const custom = screen.getByTestId("custom-order-000002");
    expect(custom).toHaveTextContent("Ada – Custom Dress");
    expect(custom).toHaveTextContent("Stage 2 of 3");
    const shop = screen.getByTestId("shop-order-SHP-ABC-1234");
    expect(shop).toHaveTextContent("SHP-ABC-1234");
    expect(shop).toHaveTextContent("$42");
  });

  it("shows an empty state when there are no orders", () => {
    stubHook(mockOverview, {
      data: { email: "new@example.com", customOrders: [], shopOrders: [] },
    });
    renderPage();
    expect(screen.getByTestId("account-empty")).toBeInTheDocument();
  });

  it("signs out via the logout mutation", async () => {
    const user = userEvent.setup();
    stubHook(mockOverview, { data: overview });
    renderPage();

    await user.click(screen.getByTestId("button-sign-out"));
    expect(logoutMutate).toHaveBeenCalled();
  });
});
