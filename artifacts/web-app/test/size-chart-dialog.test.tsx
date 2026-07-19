import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SizeChartDialog } from "@/components/size-chart-dialog";

describe("SizeChartDialog", () => {
  it("shows the Jalie body-measurement chart for the garment variant (the default)", async () => {
    render(<SizeChartDialog />);
    await userEvent.click(screen.getByTestId("link-size-chart"));

    expect(await screen.findByText("Size Guide")).toBeInTheDocument();
    // Body-measurement columns (one header per Adult/Children table) + the band
    // tables.
    expect(screen.getAllByText("Bust").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Waist").length).toBeGreaterThan(0);
    expect(screen.getByText("Adult")).toBeInTheDocument();
    expect(screen.getByText("Children")).toBeInTheDocument();
    // Not the soaker chart.
    expect(screen.queryByText("Blade length")).not.toBeInTheDocument();
  });

  it("shows the blade-length chart for the soaker variant", async () => {
    render(<SizeChartDialog variant="soaker" />);
    await userEvent.click(screen.getByTestId("link-size-chart"));

    expect(await screen.findByText("Soaker Size Guide")).toBeInTheDocument();
    expect(screen.getByText("Blade length")).toBeInTheDocument();
    // The two blade-length bands (split at 9½", the atelier's two physical sizes).
    expect(screen.getByTestId("soaker-size-row-small")).toBeInTheDocument();
    expect(screen.getByTestId("soaker-size-row-large")).toBeInTheDocument();
    // Not the body-measurement chart.
    expect(screen.queryByText("Bust")).not.toBeInTheDocument();
  });
});
