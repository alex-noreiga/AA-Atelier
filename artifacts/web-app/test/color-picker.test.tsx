import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Fabric } from "@workspace/api-client-react";
import { ColorPicker } from "@/components/color-picker";

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

describe("ColorPicker", () => {
  it("renders a chip per palette color", () => {
    render(
      <ColorPicker palette={[IVORY, FLORAL]} value={[]} onChange={vi.fn()} />,
    );
    expect(screen.getByTestId("color-ivory")).toBeInTheDocument();
    expect(screen.getByTestId("color-floral-print")).toBeInTheDocument();
  });

  it("renders nothing when the palette is empty", () => {
    const { container } = render(
      <ColorPicker palette={[]} value={[]} onChange={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("adds a color on click and removes it on a second click", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    // Controlled: re-render with the latest value the parent would hold.
    const { rerender } = render(
      <ColorPicker palette={[IVORY, FLORAL]} value={[]} onChange={onChange} />,
    );
    await user.click(screen.getByTestId("color-ivory"));
    expect(onChange).toHaveBeenLastCalledWith(["Ivory"]);

    rerender(
      <ColorPicker
        palette={[IVORY, FLORAL]}
        value={["Ivory"]}
        onChange={onChange}
      />,
    );
    // The selected chip reflects its state.
    expect(screen.getByTestId("color-ivory")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(screen.getByTestId("color-ivory"));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("shows a swatch thumbnail for an image color, falling back on load error", () => {
    render(<ColorPicker palette={[FLORAL]} value={[]} onChange={vi.fn()} />);
    const chip = screen.getByTestId("color-floral-print");
    // The dot is a presentational <img> (empty alt), so query it directly.
    const img = chip.querySelector("img");
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute("src", "https://cdn/floral.jpg");
    // A broken thumbnail is swapped for the muted-dot fallback (no crash).
    fireEvent.error(img!);
    expect(chip.querySelector("img")).toBeNull();
    expect(chip).toBeInTheDocument();
  });
});
