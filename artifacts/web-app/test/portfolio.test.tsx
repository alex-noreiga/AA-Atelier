import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useGetPortfolio } from "@workspace/api-client-react";
import Portfolio from "@/pages/portfolio";
import { stubHook } from "./support/mock-hook";

vi.mock("@workspace/api-client-react", () => ({
  useGetPortfolio: vi.fn(),
}));

const mockHook = vi.mocked(useGetPortfolio);

const piece = (overrides: Record<string, unknown> = {}) => ({
  id: "piece-1",
  title: "Toothless",
  images: ["https://notion.test/a.png"],
  facets: [{ id: "type", values: ["Completed Dress"] }],
  publishedAt: "2026-06-01T00:00:00.000Z",
  ...overrides,
});

/** Two pieces that differ by Type, with the chip row the server would derive. */
function twoTypes() {
  return {
    pieces: [
      piece(),
      piece({
        id: "piece-2",
        title: "Knight of Midnight",
        facets: [{ id: "type", values: ["Preliminary Sketch"] }],
      }),
    ],
    filters: [
      {
        id: "type",
        label: "Type",
        options: ["Completed Dress", "Preliminary Sketch"],
      },
    ],
  };
}

describe("Portfolio", () => {
  it("shows a spinner while the gallery loads", () => {
    stubHook(mockHook as never, { isLoading: true });

    render(<Portfolio />);

    expect(screen.getByTestId("portfolio-loading")).toBeInTheDocument();
  });

  it("says the gallery couldn't be loaded on error", () => {
    stubHook(mockHook as never, { isError: true });

    render(<Portfolio />);

    expect(screen.getByTestId("portfolio-error")).toBeInTheDocument();
  });

  it("shows an empty state, not a blank grid, when nothing is published", () => {
    stubHook(mockHook as never, { data: { pieces: [], filters: [] } });

    render(<Portfolio />);

    expect(screen.getByTestId("portfolio-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("portfolio-grid")).not.toBeInTheDocument();
  });

  it("renders a card per published piece, with its caption", () => {
    stubHook(mockHook as never, { data: twoTypes() });

    render(<Portfolio />);

    const cards = screen.getAllByTestId("portfolio-piece");
    expect(cards).toHaveLength(2);
    // Scoped to the card: "Completed Dress" is also a filter chip, and the
    // caption is what this asserts.
    expect(within(cards[0]!).getByText("Toothless")).toBeInTheDocument();
    expect(within(cards[0]!).getByText("Completed Dress")).toBeInTheDocument();
  });

  it("renders only the chip rows the server sent — never a hardcoded dimension", () => {
    stubHook(mockHook as never, { data: twoTypes() });

    render(<Portfolio />);

    expect(screen.getByText("Type")).toBeInTheDocument();
    expect(screen.queryByText("Colorway")).not.toBeInTheDocument();
    expect(
      screen.getByTestId("portfolio-filter-type-completed-dress"),
    ).toBeInTheDocument();
  });

  it("shows no chips at all when the published work varies along nothing", () => {
    stubHook(mockHook as never, { data: { pieces: [piece()], filters: [] } });

    render(<Portfolio />);

    expect(screen.getByTestId("portfolio-piece")).toBeInTheDocument();
    expect(screen.queryByText("Type")).not.toBeInTheDocument();
  });

  it("narrows the grid to the chosen facet value", async () => {
    const user = userEvent.setup();
    stubHook(mockHook as never, { data: twoTypes() });

    render(<Portfolio />);
    await user.click(
      screen.getByTestId("portfolio-filter-type-completed-dress"),
    );

    expect(screen.getAllByTestId("portfolio-piece")).toHaveLength(1);
    expect(screen.getByText("Toothless")).toBeInTheDocument();
    expect(screen.queryByText("Knight of Midnight")).not.toBeInTheDocument();
  });

  it("restores the full grid from the All chip", async () => {
    const user = userEvent.setup();
    stubHook(mockHook as never, { data: twoTypes() });

    render(<Portfolio />);
    await user.click(
      screen.getByTestId("portfolio-filter-type-completed-dress"),
    );
    await user.click(screen.getByTestId("portfolio-filter-type-all"));

    expect(screen.getAllByTestId("portfolio-piece")).toHaveLength(2);
  });

  it("ANDs across dimensions: a piece has to satisfy every chosen chip", async () => {
    const user = userEvent.setup();
    stubHook(mockHook as never, {
      data: {
        pieces: [
          piece({
            id: "both",
            title: "Both",
            facets: [
              { id: "type", values: ["Completed Dress"] },
              { id: "discipline", values: ["Ice Dance"] },
            ],
          }),
          piece({
            id: "one",
            title: "One",
            facets: [
              { id: "type", values: ["Completed Dress"] },
              { id: "discipline", values: ["Freestyle"] },
            ],
          }),
        ],
        filters: [
          {
            id: "type",
            label: "Type",
            options: ["Completed Dress", "Preliminary Sketch"],
          },
          {
            id: "discipline",
            label: "Discipline",
            options: ["Freestyle", "Ice Dance"],
          },
        ],
      },
    });

    render(<Portfolio />);
    await user.click(
      screen.getByTestId("portfolio-filter-type-completed-dress"),
    );
    await user.click(
      screen.getByTestId("portfolio-filter-discipline-ice-dance"),
    );

    expect(screen.getAllByTestId("portfolio-piece")).toHaveLength(1);
    expect(screen.getByText("Both")).toBeInTheDocument();
  });

  it("ORs within a dimension: a piece filed under two values matches either chip", async () => {
    const user = userEvent.setup();
    stubHook(mockHook as never, {
      data: {
        pieces: [
          piece({
            id: "multi",
            title: "Multi",
            facets: [{ id: "discipline", values: ["Ice Dance", "Freestyle"] }],
          }),
        ],
        filters: [
          {
            id: "discipline",
            label: "Discipline",
            options: ["Freestyle", "Ice Dance"],
          },
        ],
      },
    });

    render(<Portfolio />);
    await user.click(
      screen.getByTestId("portfolio-filter-discipline-freestyle"),
    );
    expect(screen.getByText("Multi")).toBeInTheDocument();

    await user.click(
      screen.getByTestId("portfolio-filter-discipline-ice-dance"),
    );
    expect(screen.getByText("Multi")).toBeInTheDocument();
  });

  it("says so when a combination matches nothing, rather than looking broken", async () => {
    const user = userEvent.setup();
    stubHook(mockHook as never, {
      data: {
        pieces: [
          piece({
            id: "dress",
            facets: [{ id: "type", values: ["Completed Dress"] }],
          }),
          piece({
            id: "sketch",
            facets: [
              { id: "type", values: ["Preliminary Sketch"] },
              { id: "discipline", values: ["Ice Dance"] },
            ],
          }),
        ],
        filters: [
          {
            id: "type",
            label: "Type",
            options: ["Completed Dress", "Preliminary Sketch"],
          },
          {
            id: "discipline",
            label: "Discipline",
            options: ["Freestyle", "Ice Dance"],
          },
        ],
      },
    });

    render(<Portfolio />);
    // Each chip alone matches a piece; together they match neither.
    await user.click(
      screen.getByTestId("portfolio-filter-type-completed-dress"),
    );
    await user.click(
      screen.getByTestId("portfolio-filter-discipline-ice-dance"),
    );

    expect(screen.queryAllByTestId("portfolio-piece")).toHaveLength(0);
    expect(screen.getByTestId("portfolio-no-results")).toBeInTheDocument();
  });

  it("falls back to All when the chosen option disappears from the server's list", () => {
    const { rerender } = render(<Portfolio />);

    stubHook(mockHook as never, { data: twoTypes() });
    rerender(<Portfolio />);

    // Re-render with the atelier having unpublished every sketch: the option is
    // gone, so the grid must not be stranded showing nothing.
    stubHook(mockHook as never, {
      data: { pieces: [piece()], filters: [] },
    });
    rerender(<Portfolio />);

    expect(screen.getAllByTestId("portfolio-piece")).toHaveLength(1);
    expect(
      screen.queryByTestId("portfolio-no-results"),
    ).not.toBeInTheDocument();
  });
});
