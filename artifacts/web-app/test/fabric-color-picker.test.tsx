import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Fabric, FabricSelection } from "@workspace/api-client-react";
import { FabricColorPicker } from "@/components/fabric-color-picker";

const IVORY: Fabric = {
  id: "ivory",
  name: "Ivory",
  type: "solid",
  placement: "both",
  hex: "#F4EFE6",
};
const FLORAL: Fabric = {
  id: "floral",
  name: "Floral Print",
  type: "print",
  placement: "bodice",
  swatchImage: "https://cdn/floral.jpg",
};
const SKIRT_ONLY: Fabric = {
  id: "emerald",
  name: "Emerald",
  type: "solid",
  placement: "skirt",
  hex: "#0B6E4F",
};

/** A stateful wrapper so the controlled picker reflects its own changes, with an
 * optional spy on each onChange. */
function Harness({
  fabrics,
  placement = "bodice",
  onChangeSpy,
}: {
  fabrics: Fabric[];
  placement?: "bodice" | "skirt";
  onChangeSpy?: (value: FabricSelection) => void;
}) {
  const [value, setValue] = useState<FabricSelection>({});
  return (
    <FabricColorPicker
      placement={placement}
      fabrics={fabrics}
      value={value}
      onChange={(next) => {
        onChangeSpy?.(next);
        setValue(next);
      }}
    />
  );
}

describe("FabricColorPicker", () => {
  it("groups swatches by fabric type under their headings", () => {
    render(<Harness fabrics={[IVORY, FLORAL]} placement="bodice" />);
    expect(screen.getByText("Solid colors")).toBeInTheDocument();
    expect(screen.getByText("Prints")).toBeInTheDocument();
    // No sequin group renders when there are no sequin swatches.
    expect(screen.queryByText("Sequin")).not.toBeInTheDocument();
  });

  it("filters swatches by placement (skirt-only omitted from the bodice picker)", () => {
    render(<Harness fabrics={[IVORY, SKIRT_ONLY]} placement="bodice" />);
    // "both" shows; the skirt-only swatch does not.
    expect(screen.getByTestId("fabric-bodice-ivory")).toBeInTheDocument();
    expect(
      screen.queryByTestId("fabric-bodice-emerald"),
    ).not.toBeInTheDocument();
  });

  it("selecting a swatch records it and clears a prior color note", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Harness fabrics={[IVORY]} placement="bodice" onChangeSpy={onChange} />,
    );
    // Open the escape hatch and type a note first.
    await user.click(screen.getByTestId("fabric-bodice-escape-hatch"));
    await user.type(
      screen.getByTestId("fabric-bodice-color-note"),
      "dusty rose",
    );
    // Now choose a swatch — the note must be cleared (mutually exclusive).
    await user.click(screen.getByTestId("fabric-bodice-ivory"));

    const last = onChange.mock.calls.at(-1)![0];
    expect(last).toEqual({
      fabricId: "ivory",
      fabricName: "Ivory",
      fabricType: "solid",
    });
    // The note textarea is gone once a swatch is chosen.
    expect(
      screen.queryByTestId("fabric-bodice-color-note"),
    ).not.toBeInTheDocument();
  });

  it("opening the escape hatch clears a chosen swatch", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Harness fabrics={[IVORY]} placement="bodice" onChangeSpy={onChange} />,
    );
    await user.click(screen.getByTestId("fabric-bodice-ivory"));
    await user.click(screen.getByTestId("fabric-bodice-escape-hatch"));

    const last = onChange.mock.calls.at(-1)![0];
    expect(last).not.toHaveProperty("fabricId");
    // The free-text field is now shown.
    expect(screen.getByTestId("fabric-bodice-color-note")).toBeInTheDocument();
  });

  it("shows only the escape hatch + custom-print paths when there are no swatches", () => {
    render(<Harness fabrics={[]} placement="skirt" />);
    expect(screen.queryByText("Solid colors")).not.toBeInTheDocument();
    expect(screen.getByTestId("fabric-skirt-escape-hatch")).toBeInTheDocument();
    // The custom-print upload is always offered.
    expect(screen.getByText("Custom print")).toBeInTheDocument();
  });

  it("falls back to a monogram placeholder when a swatch image fails to load", () => {
    render(<Harness fabrics={[FLORAL]} placement="bodice" />);
    const img = screen.getByAltText("Floral Print");
    fireEvent.error(img);
    // The broken image is replaced by the "AA" monogram placeholder.
    expect(screen.queryByAltText("Floral Print")).not.toBeInTheDocument();
    expect(screen.getByTestId("fabric-bodice-floral-print")).toHaveTextContent(
      "AA",
    );
  });
});
