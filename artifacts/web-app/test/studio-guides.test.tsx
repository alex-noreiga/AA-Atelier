// The how-to guides panel. The generated hook is mocked, so what's tested is
// the panel's own job: rendering a guide in a frame that can't run it, keeping
// a broken guide visible with the reason, staying completely silent at a render
// point that has no guide, and saying plainly when the database isn't wired up.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const h = vi.hoisted(() => ({
  guides: {
    data: undefined as unknown,
    isLoading: false,
    isError: false,
    error: null as unknown,
  },
  content: {
    data: undefined as unknown,
    isLoading: false,
    isError: false,
    error: null as unknown,
  },
  /** What the content hook was asked for, and whether it was enabled — "did
   * opening this guide actually fetch anything?" is the behaviour under test,
   * not just what rendered. */
  contentCalls: [] as Array<{ id: string; enabled: boolean }>,
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetStudioGuides: () => h.guides,
  getGetStudioGuidesQueryKey: () => ["/api/studio/guides"],
  useGetStudioGuideContent: (
    id: string,
    opts?: { query?: { enabled?: boolean } },
  ) => {
    const enabled = opts?.query?.enabled !== false;
    h.contentCalls.push({ id, enabled });
    return enabled
      ? h.content
      : { data: undefined, isLoading: false, isError: false, error: null };
  },
  getGetStudioGuideContentQueryKey: (id: string) => ["/api/studio/guides", id],
}));

import { StudioGuides, GuidesFor } from "@/components/studio-guides";

const SECTIONS = [
  { id: "invoice-lines", label: "Itemize an invoice" },
  { id: "materials", label: "Materials" },
  { id: "general", label: "General" },
];

function guide(overrides: Record<string, unknown> = {}) {
  return {
    id: "guide-1",
    title: "Building an invoice",
    section: "invoice-lines",
    notionUrl: "https://notion.so/guide-1",
    ...overrides,
  };
}

function list(overrides: Record<string, unknown> = {}) {
  return { guides: [], sections: SECTIONS, configured: true, ...overrides };
}

/** Open a guide's disclosure — the frame is mounted only once asked for. */
function openFirstGuide() {
  const details = screen.getAllByTestId("guide")[0] as HTMLDetailsElement;
  details.open = true;
  fireEvent(details, new Event("toggle", { bubbles: false }));
}

beforeEach(() => {
  h.contentCalls = [];
  h.guides = {
    data: list(),
    isLoading: false,
    isError: false,
    error: null,
  };
  h.content = {
    data: { id: "guide-1", html: "<h1>How to build an invoice</h1>" },
    isLoading: false,
    isError: false,
    error: null,
  };
});

describe("GuidesFor", () => {
  it("renders the guides filed against its own section", () => {
    h.guides = { ...h.guides, data: list({ guides: [guide()] }) };

    render(<GuidesFor section="invoice-lines" />);

    expect(screen.getByTestId("guides-for-invoice-lines")).toBeInTheDocument();
    expect(screen.getByText("Building an invoice")).toBeInTheDocument();
  });

  // A tool card must not sprout a skeleton or an empty state because the
  // atelier hasn't written that guide yet.
  it("renders nothing for a section with no guide", () => {
    h.guides = { ...h.guides, data: list({ guides: [guide()] }) };

    const { container } = render(<GuidesFor section="materials" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing while loading or on error", () => {
    h.guides = {
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
    };
    const loading = render(<GuidesFor section="invoice-lines" />);
    expect(loading.container).toBeEmptyDOMElement();

    h.guides = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("nope"),
    };
    const failed = render(<GuidesFor section="invoice-lines" />);
    expect(failed.container).toBeEmptyDOMElement();
  });

  // The security boundary: a guide is an uploaded file on an origin holding a
  // signed-in staff session, so it must never be able to run.
  it("renders the markup in a frame that grants neither scripts nor same-origin", () => {
    h.guides = { ...h.guides, data: list({ guides: [guide()] }) };

    render(<GuidesFor section="invoice-lines" />);
    openFirstGuide();

    const frame = screen.getByTestId("guide-frame");
    expect(frame).toHaveAttribute("srcdoc", "<h1>How to build an invoice</h1>");
    const sandbox = frame.getAttribute("sandbox") ?? "";
    expect(sandbox).not.toContain("allow-scripts");
    expect(sandbox).not.toContain("allow-same-origin");
  });

  // The whole reason markup is a second request: a dashboard carrying a dozen
  // guides must download none of them until someone opens one.
  it("fetches nothing until the guide is opened", () => {
    h.guides = { ...h.guides, data: list({ guides: [guide()] }) };

    render(<GuidesFor section="invoice-lines" />);

    expect(screen.queryByTestId("guide-frame")).not.toBeInTheDocument();
    expect(h.contentCalls.every((call) => !call.enabled)).toBe(true);
  });

  it("requests the markup once opened", () => {
    h.guides = { ...h.guides, data: list({ guides: [guide()] }) };

    render(<GuidesFor section="invoice-lines" />);
    openFirstGuide();

    expect(h.contentCalls.some((call) => call.enabled)).toBe(true);
  });

  // The listing already knows this one can't render, so opening it must not
  // spend a request finding out.
  it("never requests markup for a guide the listing marked unavailable", () => {
    h.guides = {
      ...h.guides,
      data: list({ guides: [guide({ unavailable: "no-file" })] }),
    };

    render(<GuidesFor section="invoice-lines" />);
    openFirstGuide();

    expect(h.contentCalls.every((call) => !call.enabled)).toBe(true);
    expect(screen.getByTestId("guide-unavailable")).toBeInTheDocument();
  });

  it("explains a pasted link, which is never fetched", () => {
    h.guides = {
      ...h.guides,
      data: list({ guides: [guide({ unavailable: "not-uploaded" })] }),
    };

    render(<GuidesFor section="invoice-lines" />);

    expect(screen.getByTestId("guide-unavailable")).toHaveTextContent(
      "pasted link",
    );
  });

  it("reports a download that failed at open time", () => {
    h.guides = { ...h.guides, data: list({ guides: [guide()] }) };
    h.content = {
      data: { id: "guide-1", unavailable: "too-large" },
      isLoading: false,
      isError: false,
      error: null,
    };

    render(<GuidesFor section="invoice-lines" />);
    openFirstGuide();

    expect(screen.getByTestId("guide-unavailable")).toHaveTextContent(
      "too large",
    );
    expect(screen.queryByTestId("guide-frame")).not.toBeInTheDocument();
  });

  // A guide whose file can't be shown stays visible with the reason — absent
  // would be indistinguishable from one nobody wrote.
  it("keeps an unrenderable guide listed, with why", () => {
    h.guides = {
      ...h.guides,
      data: list({
        guides: [guide({ unavailable: "not-html", fileName: "g.pdf" })],
      }),
    };

    render(<GuidesFor section="invoice-lines" />);

    expect(screen.getByText("Building an invoice")).toBeInTheDocument();
    expect(screen.getByTestId("guide-unavailable")).toHaveTextContent("g.pdf");
    expect(screen.queryByTestId("guide-frame")).not.toBeInTheDocument();
  });
});

describe("StudioGuides", () => {
  it("shows a spinner while loading", () => {
    h.guides = {
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
    };

    render(<StudioGuides />);
    expect(screen.getByTestId("guides-loading")).toBeInTheDocument();
  });

  it("says when the database isn't connected", () => {
    h.guides = { ...h.guides, data: list({ configured: false }) };

    render(<StudioGuides />);
    expect(screen.getByTestId("guides-unconfigured")).toBeInTheDocument();
    expect(screen.queryByTestId("guides-empty")).not.toBeInTheDocument();
  });

  // Distinct from unconfigured: the fix is sharing the database, not setting
  // the env var, and the panel must name the right one.
  it("says what to fix when Notion can't see the database", () => {
    h.guides = {
      ...h.guides,
      data: list({ configured: true, unreachable: true }),
    };

    render(<StudioGuides />);

    expect(screen.getByTestId("guides-unreachable")).toBeInTheDocument();
    expect(screen.queryByTestId("guides-empty")).not.toBeInTheDocument();
    expect(screen.queryByTestId("guides-unconfigured")).not.toBeInTheDocument();
  });

  it("says how to add one when nothing has been written", () => {
    render(<StudioGuides />);
    expect(screen.getByTestId("guides-empty")).toBeInTheDocument();
  });

  it("renders the general guides and counts the ones shown elsewhere", () => {
    h.guides = {
      ...h.guides,
      data: list({
        guides: [
          guide({ id: "a", title: "Shipping day", section: "general" }),
          guide({ id: "b", title: "Building an invoice" }),
        ],
      }),
    };

    render(<StudioGuides />);

    expect(screen.getByText("Shipping day")).toBeInTheDocument();
    expect(screen.queryByText("Building an invoice")).not.toBeInTheDocument();
    expect(screen.getByTestId("guides-elsewhere")).toHaveTextContent(
      "1 other guide is shown beside the tool or panel it covers.",
    );
  });

  // The accepted Section values are otherwise only discoverable by reading the
  // server's source.
  it("lists the sections a guide can be filed against", () => {
    render(<StudioGuides />);
    expect(screen.getByTestId("guides-sections")).toHaveTextContent(
      "Itemize an invoice",
    );
  });

  it("says when the list is partial", () => {
    h.guides = {
      ...h.guides,
      data: list({ guides: [guide({ section: "general" })], truncated: true }),
    };

    render(<StudioGuides />);
    expect(screen.getByTestId("guides-truncated")).toBeInTheDocument();
  });

  it("shows the server's reason when the read fails", () => {
    h.guides = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("nope"),
    };

    render(<StudioGuides />);
    expect(screen.getByTestId("guides-error")).toBeInTheDocument();
  });
});
