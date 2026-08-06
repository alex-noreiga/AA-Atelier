import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Color } from "@workspace/api-client-react";
import { ColorPicker } from "@/components/color-picker";

const IVORY: Color = { id: "ivory", name: "Ivory", hex: "#F3ECE2" };
const ROSE_GOLD: Color = { id: "rose-gold", name: "Rose Gold", hex: "#C5878C" };

describe("ColorPicker", () => {
  it("renders a chip per palette color", () => {
    render(
      <ColorPicker
        palette={[IVORY, ROSE_GOLD]}
        value={[]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("color-ivory")).toBeInTheDocument();
    expect(screen.getByTestId("color-rose-gold")).toBeInTheDocument();
  });

  it("renders a hex-fill dot for each color", () => {
    render(<ColorPicker palette={[IVORY]} value={[]} onChange={vi.fn()} />);
    const dot = screen.getByTestId("color-ivory").querySelector("span");
    expect(dot).not.toBeNull();
    expect(dot).toHaveStyle({ backgroundColor: "#F3ECE2" });
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
      <ColorPicker
        palette={[IVORY, ROSE_GOLD]}
        value={[]}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByTestId("color-ivory"));
    expect(onChange).toHaveBeenLastCalledWith(["Ivory"]);

    rerender(
      <ColorPicker
        palette={[IVORY, ROSE_GOLD]}
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
});
