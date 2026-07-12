import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { stubHook } from "./support/mock-hook.js";

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
    sizes: [],
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

/** The server sends the live Item Type options; the page prepends "All". */
function setHook(state: {
  products?: unknown[];
  categories?: string[];
  isLoading?: boolean;
  isError?: boolean;
}) {
  stubHook(mockHook, {
    data: state.products
      ? { products: state.products, categories: state.categories ?? [] }
      : undefined,
    isLoading: state.isLoading,
    isError: state.isError,
  });
}

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
    setHook({
      products: [product(), product({ id: "p2", title: "Scrunchie" })],
    });
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

  it("shows cents only when the Listed Price has them", () => {
    setHook({
      products: [
        product({ id: "p1", variants: [variant({ id: "v1", price: 22 })] }),
        product({ id: "p2", variants: [variant({ id: "v2", price: 22.5 })] }),
      ],
    });
    render(<Shop />);
    expect(screen.getByText("$22")).toBeInTheDocument();
    expect(screen.getByText("$22.50")).toBeInTheDocument();
  });

  it("falls back to an inquire-for-price line when Listed Price is empty in Notion", () => {
    setHook({ products: [product()] });
    render(<Shop />);
    expect(screen.getByText("inquire for price")).toBeInTheDocument();
  });
});

describe("Shop category filter", () => {
  it("renders the live Item Type options the server sent, in Notion's order", () => {
    setHook({
      products: [
        product({ id: "p1", category: "Soaker" }),
        product({ id: "p2", category: "Dress" }),
      ],
      // Notion's ordering — deliberately NOT alphabetical.
      categories: ["Soaker", "Dress"],
    });
    render(<Shop />);
    const chips = screen
      .getAllByTestId(/^filter-/)
      .map((chip) => chip.textContent);
    expect(chips).toEqual(["All", "Soaker", "Dress"]);
  });

  it("hides the filter bar when the server sends a single category", () => {
    setHook({
      products: [product({ id: "p1" }), product({ id: "p2" })],
      categories: ["Soaker"],
    });
    render(<Shop />);
    expect(screen.queryByTestId("filter-all")).not.toBeInTheDocument();
  });

  it("narrows the grid to the selected category", async () => {
    setHook({
      products: [
        product({ id: "p1", category: "Soaker" }),
        product({ id: "p2", category: "Dress" }),
      ],
      categories: ["Dress", "Soaker"],
    });
    render(<Shop />);
    await userEvent.click(screen.getByTestId("filter-dress"));
    expect(screen.getByTestId("product-p2")).toBeInTheDocument();
    expect(screen.queryByTestId("product-p1")).not.toBeInTheDocument();
  });

  it("falls back to All when the active category disappears from a refetch", async () => {
    setHook({
      products: [
        product({ id: "p1", category: "Soaker" }),
        product({ id: "p2", category: "Dress" }),
      ],
      categories: ["Dress", "Soaker"],
    });
    const { rerender } = render(<Shop />);
    await userEvent.click(screen.getByTestId("filter-dress"));

    // The team retires the "Dress" option in Notion.
    setHook({
      products: [product({ id: "p1", category: "Soaker" })],
      categories: ["Soaker"],
    });
    rerender(<Shop />);

    // Not stranded on a dead chip showing an empty grid.
    expect(screen.getByTestId("product-p1")).toBeInTheDocument();
    expect(screen.queryByTestId("shop-empty")).not.toBeInTheDocument();
  });
});

describe("Shop sizes", () => {
  const dress = (sizes: Array<{ name: string; available: boolean }>) =>
    product({
      id: "p1",
      title: "Keyhole Test Dress",
      category: "Dress",
      variants: [variant({ id: "v1", name: "Keyhole Test Dress", sizes })],
    });

  it("lists the sizes the item is offered in", () => {
    setHook({
      products: [
        dress([
          { name: "Adult XS", available: true },
          { name: "Adult S", available: true },
        ]),
      ],
    });
    render(<Shop />);
    expect(screen.getAllByTestId("size-v1-adult-xs").length).toBeGreaterThan(0);
    expect(screen.getAllByTestId("size-v1-adult-s").length).toBeGreaterThan(0);
  });

  it("offers a per-size back-in-stock request for a sold-out size", () => {
    setHook({
      products: [
        dress([
          { name: "Adult XS", available: true },
          { name: "Adult S", available: false },
        ]),
      ],
    });
    render(<Shop />);
    // The in-stock size is an inert label, not a notify link.
    expect(
      screen.queryByTestId("size-notify-v1-adult-xs"),
    ).not.toBeInTheDocument();
    // The sold-out size links to a request naming that exact size.
    expect(screen.getAllByTestId("size-notify-v1-adult-s")[0]).toHaveAttribute(
      "href",
      "/contact?item=Keyhole%20Test%20Dress%20%E2%80%94%20Adult%20S&notify=1",
    );
  });

  it("shows the size chart on garments but not on accessories", () => {
    setHook({ products: [dress([{ name: "Adult S", available: true }])] });
    const { unmount } = render(<Shop />);
    expect(screen.getAllByTestId("link-size-chart").length).toBeGreaterThan(0);
    unmount();

    // A soaker has no size bands and no size guide — it doesn't apply.
    setHook({ products: [product()] });
    render(<Shop />);
    expect(screen.queryByTestId("link-size-chart")).not.toBeInTheDocument();
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
