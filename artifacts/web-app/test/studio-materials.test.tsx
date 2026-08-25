// The materials restock panel. The generated hook is mocked, so what's tested
// is the panel's own job: leading with what to reorder, grouping it the way the
// atelier shops (by category, fabric by fabric type), making the unwatched
// materials visible rather than letting an empty alert list read as "all good",
// and saying plainly when the database isn't connected.
//
// The grouping RULES are pinned in `material-groups.test.ts`; what's asserted
// here is that the panel actually renders them.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

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
    notRestockable: [],
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

describe("StudioMaterials — grouping", () => {
  const FABRIC_MESH = {
    ...LOW,
    id: "mesh",
    name: "Black Power Mesh",
    category: "Fabric",
    fabricTypes: ["Power Mesh", "Lining"],
    shortfall: 3,
  };
  const FABRIC_SATIN = {
    ...LOW,
    id: "satin",
    name: "Ivory Satin",
    category: "Fabric",
    fabricTypes: ["Satin"],
    shortfall: 1,
  };
  const BOX = {
    ...LOW,
    id: "box",
    name: "Garment bags",
    category: "Packaging",
    shortfall: 2,
  };

  it("heads each category, and leads with the one holding the worst shortfall", () => {
    h.materials.data = overview({ lowStock: [FABRIC_MESH, BOX, FABRIC_SATIN] });
    const { container } = render(<StudioMaterials />);

    expect(screen.getByTestId("material-category-fabric")).toBeInTheDocument();
    expect(
      screen.getByTestId("material-category-packaging"),
    ).toBeInTheDocument();

    const headings = [...container.querySelectorAll("h3")].map(
      (h3) => h3.textContent ?? "",
    );
    expect(headings[0]).toMatch(/Fabric/);
    expect(headings[1]).toMatch(/Packaging/);
  });

  it("sub-heads fabric by its type", () => {
    h.materials.data = overview({ lowStock: [FABRIC_MESH, FABRIC_SATIN] });
    render(<StudioMaterials />);

    expect(screen.getByTestId("material-fabric-power-mesh")).toHaveTextContent(
      "Black Power Mesh",
    );
    expect(screen.getByTestId("material-fabric-satin")).toHaveTextContent(
      "Ivory Satin",
    );
  });

  it("shows a multi-typed fabric once, under its first type only", () => {
    h.materials.data = overview({ lowStock: [FABRIC_MESH] });
    render(<StudioMaterials />);

    // Under its first type only — not repeated under "Lining", which on a
    // shopping list is how you buy the same fabric twice.
    expect(screen.getAllByTestId("material-row")).toHaveLength(1);
    expect(screen.queryByTestId("material-fabric-lining")).toBeNull();
    // And the row doesn't carry the other type as a trailing label: it already
    // sits under a heading that names what it is.
    expect(screen.getByTestId("material-row")).not.toHaveTextContent(/lining/i);
  });

  // Fabric is the long group; once it's been shopped it's in the way of
  // everything under it. But a shopping list that greets you collapsed is one
  // whose whole point has to be clicked for, so it opens.
  it("opens each category by default, and folds it away on a click", () => {
    h.materials.data = overview({ lowStock: [FABRIC_MESH, BOX] });
    render(<StudioMaterials />);

    const fabric = screen.getByTestId("material-category-fabric");
    expect(fabric).toHaveAttribute("open");

    fireEvent.click(fabric.querySelector("summary")!);
    expect(fabric).not.toHaveAttribute("open");
    // Folding one category leaves the rest as they were.
    expect(screen.getByTestId("material-category-packaging")).toHaveAttribute(
      "open",
    );
  });

  it("doesn't sub-head a category with no fabric types", () => {
    h.materials.data = overview({ lowStock: [BOX] });
    render(<StudioMaterials />);

    expect(screen.getByTestId("material-category-packaging")).toBeVisible();
    expect(screen.queryByTestId("material-fabric-unspecified")).toBeNull();
  });

  it("groups the unwatched list the same way", () => {
    h.materials.data = overview({
      untracked: [
        {
          id: "u1",
          name: "Gold Thread",
          category: "Notions",
          reason: "stock-unknown",
        },
        {
          id: "u2",
          name: "Velvet",
          category: "Fabric",
          fabricTypes: ["Velvet"],
          reason: "no-reorder-point",
          stockOnHand: 3,
        },
      ],
    });
    render(<StudioMaterials />);

    expect(screen.getByTestId("material-category-fabric")).toBeInTheDocument();
    expect(screen.getByTestId("material-category-notions")).toBeInTheDocument();
    expect(screen.getByTestId("material-fabric-velvet")).toHaveTextContent(
      "Velvet",
    );
  });

  it("files a material with no category under a catch-all heading", () => {
    h.materials.data = overview({
      lowStock: [
        { ...LOW, id: "mystery", name: "Mystery trim", category: undefined },
      ],
    });
    render(<StudioMaterials />);

    expect(
      screen.getByTestId("material-category-uncategorized"),
    ).toHaveTextContent("Mystery trim");
  });
});

describe("StudioMaterials — what can't be reordered", () => {
  const DEAD = {
    ...LOW,
    id: "dead",
    name: "Black Rhinestone Velvet",
    category: "Fabric",
    fabricTypes: ["Velvet"],
    reorderStatus: "Deadstock",
    shortfall: 2,
  };

  it("keeps it out of the reorder list and gives it its own section", () => {
    h.materials.data = overview({ lowStock: [], notRestockable: [DEAD] });
    render(<StudioMaterials />);

    const section = screen.getByTestId("materials-not-restockable");
    expect(section).toHaveTextContent("Black Rhinestone Velvet");
    expect(section).toHaveTextContent(/deadstock or discontinued/i);
    // The count chip counts what can actually be bought.
    expect(screen.queryByTestId("materials-low-count")).toBeNull();
  });

  it("says which status put it there", () => {
    h.materials.data = overview({ notRestockable: [DEAD] });
    render(<StudioMaterials />);
    expect(screen.getByTestId("material-row")).toHaveTextContent("Deadstock");
  });

  it("renders nothing when everything low can be bought again", () => {
    h.materials.data = overview({ lowStock: [LOW], notRestockable: [] });
    render(<StudioMaterials />);
    expect(screen.queryByTestId("materials-not-restockable")).toBeNull();
  });

  it("labels a made-to-order material on the reorder list, but not a plain one", () => {
    h.materials.data = overview({
      lowStock: [
        {
          ...LOW,
          id: "custom",
          name: "Dyed Satin",
          reorderStatus: "Made to order",
        },
        {
          ...LOW,
          id: "plain",
          name: "Power Mesh",
          reorderStatus: "Restockable",
        },
      ],
    });
    render(<StudioMaterials />);

    const rows = screen.getAllByTestId("material-row");
    expect(
      rows.find((r) => r.textContent?.includes("Dyed Satin")),
    ).toHaveTextContent("Made to order");
    // "Restockable" is the ordinary case and adds nothing to a shopping list.
    expect(
      rows.find((r) => r.textContent?.includes("Power Mesh")),
    ).not.toHaveTextContent("Restockable");
  });
});
