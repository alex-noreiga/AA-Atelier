import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, type RenderResult } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { Router, Route } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { CartProvider } from "@/lib/cart";
import { stubHook } from "./support/mock-hook.js";

// In-stock priced items now render the Add-to-cart control, which reads the
// cart context — so every Shop render needs a CartProvider around it.
const renderShop = (ui: ReactElement): RenderResult =>
  render(<CartProvider>{ui}</CartProvider>);

// Mount Shop under a memory router at a given path, so the `/shop/:productId`
// route param drives the quick-view (deep-link behavior).
function renderShopAt(path: string): RenderResult {
  const { hook } = memoryLocation({ path });
  return render(
    <CartProvider>
      <Router hook={hook}>
        <Route path="/shop/:productId" component={Shop} />
        <Route path="/shop" component={Shop} />
      </Router>
    </CartProvider>,
  );
}

// Control the data-fetching hook so we can drive each render state directly.
// The notify dialog's mutation hook is mocked here too — the shop imports it
// transitively, and this factory replaces the whole module.
vi.mock("@workspace/api-client-react", () => ({
  useGetProducts: vi.fn(),
  useCreateBackInStockRequest: vi.fn(),
}));

import {
  useGetProducts,
  useCreateBackInStockRequest,
} from "@workspace/api-client-react";
import Shop, { indexVariants, resolveAddOns } from "@/pages/shop";
import type { Product, ProductVariant } from "@workspace/api-client-react";

const mockHook = vi.mocked(useGetProducts);
const mockNotify = vi.mocked(useCreateBackInStockRequest);

/** The notify mutation, stubbed to capture what the dialog submits. */
const notifyMutate = vi.fn();
beforeEach(() => {
  notifyMutate.mockReset();
  mockNotify.mockReturnValue({
    mutate: notifyMutate,
    isPending: false,
  } as never);
});

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
    sized: false,
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
    renderShop(<Shop />);
    expect(screen.getByTestId("shop-loading")).toBeInTheDocument();
  });

  it("keeps the page usable when inventory fails to load", () => {
    setHook({ isError: true });
    renderShop(<Shop />);
    expect(screen.getByTestId("shop-error")).toBeInTheDocument();
    // The commission CTA must survive an error — it's the fallback path.
    expect(screen.getByTestId("cta-commission")).toBeInTheDocument();
  });

  it("invites a commission when nothing is in stock", () => {
    setHook({ products: [] });
    renderShop(<Shop />);
    expect(screen.getByTestId("shop-empty")).toBeInTheDocument();
    expect(screen.getByTestId("cta-commission")).toBeInTheDocument();
  });

  it("renders a card per product", () => {
    setHook({
      products: [product(), product({ id: "p2", title: "Scrunchie" })],
    });
    renderShop(<Shop />);
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
    renderShop(<Shop />);
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
    renderShop(<Shop />);
    expect(screen.getByText("$22")).toBeInTheDocument();
    expect(screen.getByText("$22.50")).toBeInTheDocument();
  });

  it("falls back to an inquire-for-price line when Listed Price is empty in Notion", () => {
    setHook({ products: [product()] });
    renderShop(<Shop />);
    expect(screen.getByText("inquire for price")).toBeInTheDocument();
  });
});

describe("Shop matching add-ons", () => {
  // The cloth is its own in-stock, priced product; the soaker points at it via
  // addOnIds. This exercises the full prop chain: Shop builds the variant index,
  // ProductCard resolves the selected variant's add-ons, and AddToCartButton
  // surfaces the checkbox.
  function soakerAndCloth() {
    return [
      product({
        id: "soaker",
        title: "Bow Fleece Soaker",
        variants: [variant({ id: "soaker", price: 22, addOnIds: ["cloth"] })],
      }),
      product({
        id: "cloth",
        title: "Blade Cloth",
        variants: [variant({ id: "cloth", name: "Blade Cloth", price: 12 })],
      }),
    ];
  }

  it("surfaces the matching add-on checkbox on a soaker card", () => {
    setHook({ products: soakerAndCloth() });
    // Grid level (no dialog open) — VariantCta renders in both the card body and
    // the quick-view, so a deep-linked open dialog would duplicate the testid.
    renderShop(<Shop />);
    expect(screen.getByTestId("add-on-checkbox-cloth")).toBeInTheDocument();
    expect(screen.getByTestId("add-on-cloth")).toHaveTextContent("Blade Cloth");
  });

  it("does not offer an add-on that is sold out", () => {
    const [soaker] = soakerAndCloth();
    setHook({
      products: [
        soaker,
        product({
          id: "cloth",
          title: "Blade Cloth",
          variants: [
            variant({
              id: "cloth",
              name: "Blade Cloth",
              price: 12,
              available: false,
            }),
          ],
        }),
      ],
    });
    renderShop(<Shop />);
    expect(
      screen.queryByTestId("add-on-checkbox-cloth"),
    ).not.toBeInTheDocument();
  });
});

describe("Shop product deep links", () => {
  it("opens the quick-view and emits Product JSON-LD when deep-linked by id", () => {
    setHook({
      products: [
        product({
          id: "p1",
          title: "Bow Fleece Soaker",
          variants: [variant({ price: 22 })],
        }),
      ],
    });
    renderShopAt("/shop/p1");

    // The controlled quick-view opens straight from the URL param.
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // Product structured data is injected for search indexing.
    const jsonLd = document.querySelector('script[type="application/ld+json"]');
    expect(jsonLd).not.toBeNull();
    const data = JSON.parse(jsonLd?.textContent ?? "{}");
    expect(data["@type"]).toBe("Product");
    expect(data.name).toBe("Bow Fleece Soaker");
    expect(data.offers).toMatchObject({
      price: 22,
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
    });
  });

  it("stays on the grid for an unknown product id", () => {
    setHook({ products: [product({ id: "p1" })] });
    renderShopAt("/shop/does-not-exist");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("product-p1")).toBeInTheDocument();
  });

  it("navigates to the product URL when a card is opened (shareable link)", async () => {
    setHook({
      products: [product({ id: "p1", variants: [variant({ price: 22 })] })],
    });
    renderShopAt("/shop");

    // Nothing open on the grid.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId("product-view-p1"));

    // Opening navigates to /shop/p1, and the route param drives the dialog open —
    // proving the full open → navigate → param → open loop.
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
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
    renderShop(<Shop />);
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
    renderShop(<Shop />);
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
    renderShop(<Shop />);
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
    const { rerender } = renderShop(<Shop />);
    await userEvent.click(screen.getByTestId("filter-dress"));

    // The team retires the "Dress" option in Notion.
    setHook({
      products: [product({ id: "p1", category: "Soaker" })],
      categories: ["Soaker"],
    });
    rerender(
      <CartProvider>
        <Shop />
      </CartProvider>,
    );

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
      sized: true,
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
    renderShop(<Shop />);
    expect(screen.getAllByTestId("size-v1-adult-xs").length).toBeGreaterThan(0);
    expect(screen.getAllByTestId("size-v1-adult-s").length).toBeGreaterThan(0);
  });

  it("offers a per-size back-in-stock request for a sold-out size", async () => {
    setHook({
      products: [
        dress([
          { name: "Adult XS", available: true },
          { name: "Adult S", available: false },
        ]),
      ],
    });
    renderShop(<Shop />);
    // The in-stock size is an inert label, not a notify trigger.
    expect(
      screen.queryByTestId("size-notify-v1-adult-xs"),
    ).not.toBeInTheDocument();

    // The sold-out size opens a request naming that exact size.
    await userEvent.click(screen.getAllByTestId("size-notify-v1-adult-s")[0]);
    await userEvent.type(
      screen.getByTestId("notify-email"),
      "grace@example.com",
    );
    await userEvent.click(screen.getByTestId("notify-submit"));

    expect(notifyMutate).toHaveBeenCalledWith({
      data: {
        email: "grace@example.com",
        item: "Keyhole Test Dress",
        size: "Adult S",
      },
    });
  });

  it("shows the size chart on garments but not on accessories", () => {
    setHook({ products: [dress([{ name: "Adult S", available: true }])] });
    const { unmount } = renderShop(<Shop />);
    expect(screen.getAllByTestId("link-size-chart").length).toBeGreaterThan(0);
    unmount();

    // A soaker has no size bands and no size guide — it doesn't apply.
    setHook({ products: [product()] });
    renderShop(<Shop />);
    expect(screen.queryByTestId("link-size-chart")).not.toBeInTheDocument();
  });

  it("shows the size chart from the server `sized` flag, not the category name", () => {
    // `sized` is decided server-side (the Notion "Product Categories" data), so a
    // card shows the chart whenever the flag is set — regardless of its category
    // label. This is what makes the size-chart categories editable in Notion.
    setHook({
      products: [
        product({
          id: "p1",
          title: "Keyhole Test Dress",
          category: "Test Dresses",
          sized: true,
          variants: [
            variant({
              id: "v1",
              name: "Keyhole Test Dress",
              sizes: [{ name: "Adult S", available: true }],
            }),
          ],
        }),
      ],
    });
    renderShop(<Shop />);
    expect(screen.getAllByTestId("link-size-chart").length).toBeGreaterThan(0);
  });

  it("opens the blade-length chart on a soaker card, driven by `sizeGuide` not the category name", async () => {
    // The card body's own size-chart link (the one shown without opening the
    // quick-view) must route by the server-resolved sizeGuide — a regression
    // guard: this call site once hardcoded the garment chart. The category is a
    // renamed one, proving routing follows sizeGuide, not the name.
    setHook({
      products: [
        product({
          id: "p1",
          title: "Bow Fleece Soaker",
          category: "Renamed Soakers",
          sized: true,
          sizeGuide: "soaker",
          variants: [variant({ id: "v1", name: "Bow Fleece Soaker" })],
        }),
      ],
    });
    renderShop(<Shop />);
    // The card body renders the size-chart link; open it and assert the
    // blade-length chart, not the Jalie body-measurement one.
    await userEvent.click(screen.getAllByTestId("link-size-chart")[0]);
    expect(await screen.findByText("Soaker Size Guide")).toBeInTheDocument();
    expect(screen.getByText("Blade length")).toBeInTheDocument();
    expect(screen.queryByText("Bust")).not.toBeInTheDocument();
  });
});

describe("Shop contact CTAs", () => {
  it("links an in-stock item to an inquiry prefilled with its name", () => {
    setHook({ products: [product()] });
    renderShop(<Shop />);
    expect(screen.getByTestId("cta-inquire-v1")).toHaveAttribute(
      "href",
      "/contact?item=Bow%20Fleece%20Soaker",
    );
  });

  it("takes an email for a sold-out item instead of sending them to the contact form", async () => {
    setHook({
      products: [product({ variants: [variant({ available: false })] })],
    });
    renderShop(<Shop />);
    expect(screen.getByText("Sold Out")).toBeInTheDocument();

    // The dialog only appears once the notify CTA is clicked.
    expect(screen.queryByTestId("notify-dialog")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("cta-notify-v1"));
    expect(screen.getByTestId("notify-dialog")).toBeInTheDocument();

    await userEvent.type(
      screen.getByTestId("notify-email"),
      "grace@example.com",
    );
    await userEvent.click(screen.getByTestId("notify-submit"));

    // No size — the whole variant is sold out.
    expect(notifyMutate).toHaveBeenCalledWith({
      data: { email: "grace@example.com", item: "Bow Fleece Soaker" },
    });
  });

  it("rejects a malformed email without calling the API", async () => {
    setHook({
      products: [product({ variants: [variant({ available: false })] })],
    });
    renderShop(<Shop />);
    await userEvent.click(screen.getByTestId("cta-notify-v1"));
    await userEvent.type(screen.getByTestId("notify-email"), "not-an-email");
    await userEvent.click(screen.getByTestId("notify-submit"));

    expect(
      await screen.findByText("Please enter a valid email address"),
    ).toBeInTheDocument();
    expect(notifyMutate).not.toHaveBeenCalled();
  });

  it("confirms the request once it is saved", async () => {
    // The mutation reports success by invoking its onSuccess callback.
    mockNotify.mockImplementation((options) => {
      return {
        mutate: () =>
          options?.mutation?.onSuccess?.(
            { success: true },
            { data: { email: "grace@example.com", item: "Bow Fleece Soaker" } },
            undefined,
            undefined as never,
          ),
        isPending: false,
      } as never;
    });
    setHook({
      products: [product({ variants: [variant({ available: false })] })],
    });
    renderShop(<Shop />);
    await userEvent.click(screen.getByTestId("cta-notify-v1"));
    await userEvent.type(
      screen.getByTestId("notify-email"),
      "grace@example.com",
    );
    await userEvent.click(screen.getByTestId("notify-submit"));

    expect(await screen.findByTestId("notify-success")).toBeInTheDocument();
  });
});

describe("resolveAddOns", () => {
  const v = (o: Record<string, unknown> = {}): ProductVariant =>
    variant(o) as ProductVariant;

  it("indexes every variant across all products by id", () => {
    const products = [
      product({ id: "p1", variants: [v({ id: "a" }), v({ id: "b" })] }),
      product({ id: "p2", variants: [v({ id: "c" })] }),
    ] as unknown as Product[];
    const byId = indexVariants(products);
    expect([...byId.keys()].sort()).toEqual(["a", "b", "c"]);
  });

  it("resolves add-on ids to their full, buyable variant records", () => {
    const cloth = v({ id: "cloth", name: "Blade Cloth", price: 12 });
    const byId = new Map([["cloth", cloth]]);
    const soaker = v({ id: "soaker", addOnIds: ["cloth"] });
    expect(resolveAddOns(soaker, byId)).toEqual([cloth]);
  });

  it("drops an add-on that is sold out, unpriced, or missing from the payload", () => {
    const soldOut = v({ id: "a", price: 12, available: false });
    const unpriced = v({ id: "b", available: true, price: undefined });
    const byId = new Map([
      ["a", soldOut],
      ["b", unpriced],
    ]);
    const soaker = v({ id: "s", addOnIds: ["a", "b", "missing"] });
    expect(resolveAddOns(soaker, byId)).toEqual([]);
  });

  it("returns an empty list when the variant has no add-ons", () => {
    expect(resolveAddOns(v({ id: "s" }), new Map())).toEqual([]);
  });
});
