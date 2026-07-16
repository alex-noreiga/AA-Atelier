import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { stubHook } from "./support/mock-hook.js";

// Control the data-fetching hook so we can drive each render state directly.
vi.mock("@workspace/api-client-react", () => ({
  useGetPortfolio: vi.fn(),
}));

import { useGetPortfolio } from "@workspace/api-client-react";
import Portfolio from "@/pages/portfolio";

const mockHook = vi.mocked(useGetPortfolio);

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: "i1",
    title: "Aurora Ice Dance Dress",
    photos: [],
    ...overrides,
  };
}

function setHook(state: {
  items?: unknown[];
  categories?: string[];
  isLoading?: boolean;
  isError?: boolean;
}) {
  stubHook(mockHook, {
    data: state.items
      ? { items: state.items, categories: state.categories ?? [] }
      : undefined,
    isLoading: state.isLoading,
    isError: state.isError,
  });
}

describe("Portfolio", () => {
  it("shows the loading state while fetching", () => {
    setHook({ isLoading: true });
    render(<Portfolio />);
    expect(screen.getByTestId("portfolio-loading")).toBeInTheDocument();
  });

  it("shows the error state when the fetch fails", () => {
    setHook({ isError: true });
    render(<Portfolio />);
    expect(screen.getByTestId("portfolio-error")).toBeInTheDocument();
  });

  it("shows the empty state when there are no items", () => {
    setHook({ items: [] });
    render(<Portfolio />);
    expect(screen.getByTestId("portfolio-empty")).toBeInTheDocument();
  });

  it("renders a card per item, with its caption", () => {
    setHook({
      items: [
        item({ id: "i1", title: "Aurora Dress", caption: "Ombré chiffon" }),
        item({ id: "i2", title: "Nocturne Leotard" }),
      ],
    });
    render(<Portfolio />);

    expect(screen.getByTestId("portfolio-item-i1")).toBeInTheDocument();
    expect(screen.getByTestId("portfolio-item-i2")).toBeInTheDocument();
    expect(screen.getByText("Ombré chiffon")).toBeInTheDocument();
  });

  it("filters items by category when a chip is clicked", async () => {
    setHook({
      items: [
        item({ id: "i1", title: "Aurora Dress", category: "Dresses" }),
        item({ id: "i2", title: "Nocturne Leotard", category: "Leotards" }),
      ],
      categories: ["Dresses", "Leotards"],
    });
    render(<Portfolio />);

    // Both visible under "All".
    expect(screen.getByTestId("portfolio-item-i1")).toBeInTheDocument();
    expect(screen.getByTestId("portfolio-item-i2")).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("filter-dresses"));

    expect(screen.getByTestId("portfolio-item-i1")).toBeInTheDocument();
    expect(screen.queryByTestId("portfolio-item-i2")).not.toBeInTheDocument();
  });
});
