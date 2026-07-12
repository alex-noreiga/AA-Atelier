import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Control the data-fetching hook so we can drive each render state directly.
vi.mock("@workspace/api-client-react", () => ({
  useGetProducts: vi.fn(),
}));

import { useGetProducts } from "@workspace/api-client-react";
import Shop from "@/pages/shop";

const mockHook = vi.mocked(useGetProducts);

function variant(overrides: Record<string, unknown> = {}) {
  return {
    id: "v1",
    name: "Bow Fleece Soaker",
    available: true,
    photos: [],
    ...overrides,
  };
}

function product(overrides: Record<string, unknown> = {}) {
  return {
    id: "p1",
    title: "Bow Fleece Soaker",
    category: "Soaker",
    variants: [variant()],
    ...overrides,
  };
}

function setHook(state: {
  products?: unknown[];
  isLoading?: boolean;
  isError?: boolean;
}) {
  mockHook.mockReturnValue({
    data: state.products ? { products: state.products } : undefined,
    isLoading: state.isLoading ?? false,
    isError: state.isError ?? false,
  } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Shop render states", () => {
  it("shows a spinner while inventory loads", () => {
    setHook({ isLoading: true });
    render(<Shop />);
    expect(screen.getByTestId("shop-loading")).toBeInTheDocument();
  });

  it("keeps the page usable when inventory fails to load", () => {
    setHook({ isError: true });
    render(<Shop />);
    expect(screen.getByTestId("shop-error")).toBeInTheDocument();
    // The commission CTA must survive an error — it's the fallback path.
    expect(screen.getByTestId("cta-commission")).toBeInTheDocument();
  });

  it("invites a commission when nothing is in stock", () => {
    setHook({ products: [] });
    render(<Shop />);
    expect(screen.getByTestId("shop-empty")).toBeInTheDocument();
    expect(screen.getByTestId("cta-commission")).toBeInTheDocument();
  });

  it("renders a card per product", () => {
    setHook({ products: [product(), product({ id: "p2", title: "Scrunchie" })] });
    render(<Shop />);
    expect(screen.getByTestId("product-p1")).toBeInTheDocument();
    expect(screen.getByTestId("product-p2")).toBeInTheDocument();
  });

  it("shows the Listing Notes description and price on the card", () => {
    setHook({
      products: [
        product({
          variants: [
            variant({ description: "Terry-lined, hand sewn.", price: 22 }),
          ],
        }),
      ],
    });
    render(<Shop />);
    expect(screen.getByText("Terry-lined, hand sewn.")).toBeInTheDocument();
    expect(screen.getByText("$22")).toBeInTheDocument();
  });

  it("falls back to an inquire-for-price line when a variant has no price", () => {
    setHook({ products: [product()] });
    render(<Shop />);
    expect(screen.getByText("inquire for price")).toBeInTheDocument();
  });
});

describe("Shop category filter", () => {
  it("derives its chips from the categories present in the inventory", () => {
    setHook({
      products: [
        product({ id: "p1", category: "Soaker" }),
        product({ id: "p2", category: "Dress" }),
      ],
    });
    render(<Shop />);
    expect(screen.getByTestId("filter-all")).toBeInTheDocument();
    expect(screen.getByTestId("filter-dress")).toBeInTheDocument();
    expect(screen.getByTestId("filter-soaker")).toBeInTheDocument();
    // Nothing invented — "Accessories" was a curated-catalogue category.
    expect(screen.queryByTestId("filter-accessories")).not.toBeInTheDocument();
  });

  it("hides the filter bar when everything shares one category", () => {
    setHook({ products: [product({ id: "p1" }), product({ id: "p2" })] });
    render(<Shop />);
    expect(screen.queryByTestId("filter-all")).not.toBeInTheDocument();
  });

  it("narrows the grid to the selected category", async () => {
    setHook({
      products: [
        product({ id: "p1", category: "Soaker" }),
        product({ id: "p2", category: "Dress" }),
      ],
    });
    render(<Shop />);
    await userEvent.click(screen.getByTestId("filter-dress"));
    expect(screen.getByTestId("product-p2")).toBeInTheDocument();
    expect(screen.queryByTestId("product-p1")).not.toBeInTheDocument();
  });

  it("only surfaces uncategorised items under All", () => {
    setHook({
      products: [
        product({ id: "p1", category: "" }),
        product({ id: "p2", category: "Dress" }),
      ],
    });
    render(<Shop />);
    // An empty Item Type must not produce an orphan chip.
    expect(screen.queryByTestId("filter-")).not.toBeInTheDocument();
    expect(screen.getByTestId("product-p1")).toBeInTheDocument();
  });
});

describe("Shop contact CTAs", () => {
  it("links an in-stock item to an inquiry prefilled with its name", () => {
    setHook({ products: [product()] });
    render(<Shop />);
    expect(screen.getByTestId("cta-inquire-v1")).toHaveAttribute(
      "href",
      "/contact?item=Bow%20Fleece%20Soaker",
    );
  });

  it("offers a back-in-stock request for a sold-out item", () => {
    setHook({
      products: [product({ variants: [variant({ available: false })] })],
    });
    render(<Shop />);
    expect(screen.getByText("Sold Out")).toBeInTheDocument();
    expect(screen.getByTestId("cta-notify-v1")).toHaveAttribute(
      "href",
      "/contact?item=Bow%20Fleece%20Soaker&notify=1",
    );
  });
});
