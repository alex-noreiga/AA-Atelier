// The materials restock panel. The generated hook is mocked, so what's tested
// is the panel's own job: leading with what to reorder, making the unwatched
// materials visible rather than letting an empty alert list read as "all good",
// and saying plainly when the database isn't connected.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  materials: {
    data: undefined as unknown,
    isLoading: false,
    isError: false,
    error: null as unknown,
  },
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetStudioMaterials: () => h.materials,
  getGetStudioMaterialsQueryKey: () => ["/api/studio/materials"],
}));

import { StudioMaterials } from "@/components/studio-materials";

function overview(overrides: Record<string, unknown> = {}) {
  return {
    lowStock: [],
    untracked: [],
    suppressedCount: 0,
    totalCount: 0,
    configured: true,
    ...overrides,
  };
}

const LOW = {
  id: "mat-1",
  name: "Black Fleece",
  category: "Fabric",
  stockOnHand: 0.25,
  minimumStock: 0.5,
  shortfall: 0.25,
};

beforeEach(() => {
  h.materials = {
    data: overview(),
    isLoading: false,
    isError: false,
    error: null,
  };
});

describe("StudioMaterials", () => {
  it("shows a spinner while loading", () => {
    h.materials = {
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
    };
    render(<StudioMaterials />);
    expect(screen.getByTestId("materials-loading")).toBeInTheDocument();
  });

  it("shows an error message when the read fails", () => {
    h.materials = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: null,
    };
    render(<StudioMaterials />);
    expect(screen.getByTestId("materials-error")).toBeInTheDocument();
  });

  it("lists what to reorder, with the stock and the reorder point", () => {
    h.materials.data = overview({ lowStock: [LOW], totalCount: 1 });
    render(<StudioMaterials />);

    expect(screen.getByText("Black Fleece")).toBeInTheDocument();
    expect(
      screen.getByText(/0\.25 left · reorder at 0\.5/),
    ).toBeInTheDocument();
    expect(screen.getByTestId("materials-low-count")).toHaveTextContent(
      "1 to reorder",
    );
  });

  it("offers a reorder link only when the material has one", () => {
    h.materials.data = overview({
      lowStock: [{ ...LOW, link: "https://example.test/fleece" }],
    });
    const { unmount } = render(<StudioMaterials />);
    expect(screen.getByRole("link", { name: /reorder/i })).toHaveAttribute(
      "href",
      "https://example.test/fleece",
    );
    unmount();

    h.materials.data = overview({ lowStock: [LOW] });
    render(<StudioMaterials />);
    expect(screen.queryByRole("link", { name: /reorder/i })).toBeNull();
  });

  it("says so when nothing is at its reorder point", () => {
    render(<StudioMaterials />);
    expect(screen.getByTestId("materials-empty")).toBeInTheDocument();
  });

  // The whole reason the untracked list exists: with only 9 of 50 materials
  // carrying a reorder point, a bare alert list would look reassuringly empty.
  it("lists the materials nothing can alert on", () => {
    h.materials.data = overview({
      untracked: [
        { id: "u1", name: "Tulle", reason: "no-reorder-point", stockOnHand: 3 },
        { id: "u2", name: "Crystals", reason: "stock-unknown" },
      ],
    });
    render(<StudioMaterials />);

    expect(screen.getByTestId("materials-untracked")).toHaveTextContent(
      "No reorder point set (2)",
    );
    expect(screen.getByText("3 on hand")).toBeInTheDocument();
    expect(screen.getByText("no stock recorded")).toBeInTheDocument();
  });

  // An unconfigured database must never render as an empty list.
  it("explains itself when the database isn't connected", () => {
    h.materials.data = overview({ configured: false });
    render(<StudioMaterials />);

    expect(screen.getByTestId("materials-unconfigured")).toBeInTheDocument();
    expect(screen.queryByTestId("materials-empty")).toBeNull();
  });

  // Configured but unreadable is its own state: the id is set, so "not
  // connected yet" would send the atelier to fix the wrong thing.
  it("names the sharing fix when Notion can't see the database", () => {
    h.materials.data = overview({ configured: true, unreachable: true });
    render(<StudioMaterials />);

    expect(screen.getByTestId("materials-unreachable")).toBeInTheDocument();
    expect(screen.queryByTestId("materials-unconfigured")).toBeNull();
    expect(screen.queryByTestId("materials-empty")).toBeNull();
  });
});
