import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { Router, Switch, Route } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { PageShell } from "@/components/page-shell";
import { RouteFocus } from "@/components/route-focus";
import { SkipLink } from "@/components/skip-link";

// A minimal two-page app mirroring App.tsx's structure: the skip link + route
// focus manager inside a Router, and pages that render through PageShell (which
// owns the #main-content focus target).
function Harness({ path }: { path: string }) {
  const { hook, navigate } = memoryLocation({ path });
  return {
    navigate,
    ...render(
      <Router hook={hook}>
        <SkipLink />
        <RouteFocus />
        <Switch>
          <Route path="/">
            <PageShell>
              <h1>Home heading</h1>
            </PageShell>
          </Route>
          <Route path="/about">
            <PageShell>
              <h1>About heading</h1>
            </PageShell>
          </Route>
          <Route path="/no-heading">
            <PageShell noise={false}>
              <p>No heading here</p>
            </PageShell>
          </Route>
        </Switch>
      </Router>,
    ),
  };
}

describe("SkipLink", () => {
  it("renders a link that points at the main-content landmark", () => {
    Harness({ path: "/" });
    const link = screen.getByTestId("skip-to-content");
    expect(link).toHaveAttribute("href", "#main-content");
    // The <main> it targets exists and is programmatically focusable.
    const main = document.getElementById("main-content");
    expect(main).not.toBeNull();
    expect(main).toHaveAttribute("tabindex", "-1");
  });
});

describe("RouteFocus", () => {
  it("does not steal focus on the initial render", () => {
    Harness({ path: "/" });
    // Focus stays on <body>; the heading is not focused on first paint.
    expect(screen.getByText("Home heading")).not.toHaveFocus();
  });

  it("moves focus to the page heading on route change", async () => {
    const { navigate } = Harness({ path: "/" });

    navigate("/about");

    const heading = await screen.findByText("About heading");
    await waitFor(() => expect(heading).toHaveFocus());
    // The heading was made programmatically focusable without entering the tab
    // order.
    expect(heading).toHaveAttribute("tabindex", "-1");
  });

  it("falls back to the main landmark when the page has no heading", async () => {
    const { navigate } = Harness({ path: "/" });

    navigate("/no-heading");

    await screen.findByText("No heading here");
    await waitFor(() =>
      expect(document.getElementById("main-content")).toHaveFocus(),
    );
  });
});
