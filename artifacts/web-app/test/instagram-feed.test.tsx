import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useGetInstagramFeed } from "@workspace/api-client-react";
import { InstagramFeed, postAltText } from "@/components/instagram-feed";
import { stubHook } from "./support/mock-hook";

vi.mock("@workspace/api-client-react", () => ({
  useGetInstagramFeed: vi.fn(),
}));

const mockHook = vi.mocked(useGetInstagramFeed);

const post = (overrides: Record<string, unknown> = {}) => ({
  id: "media-1",
  permalink: "https://www.instagram.com/p/AAA111/",
  imageUrl: "https://cdn.test/a.jpg",
  mediaType: "image",
  caption: "A finished dress, ready for Nationals",
  ...overrides,
});

describe("postAltText", () => {
  it("uses the caption's first line, not the hashtag wall below it", () => {
    // A screen reader given the whole caption reads every hashtag too.
    expect(
      postAltText({
        caption: "Aurora, finished\n\n#figureskating #costume #handmade",
      }),
    ).toBe("Aurora, finished");
  });

  it("names the studio rather than leaving alt empty", () => {
    // These are photographs of the work, not decoration.
    expect(postAltText({ caption: undefined })).toMatch(/A\.A Atelier/);
    expect(postAltText({ caption: "   " })).toMatch(/A\.A Atelier/);
  });

  it("truncates a caption written as one very long line", () => {
    const alt = postAltText({ caption: "x".repeat(400) });
    expect(alt).toHaveLength(140);
    expect(alt.endsWith("…")).toBe(true);
  });
});

describe("InstagramFeed", () => {
  it("renders a tile per post, linking out to Instagram", () => {
    stubHook(mockHook as never, {
      data: {
        posts: [post(), post({ id: "media-2", caption: "Second piece" })],
      },
    });

    render(<InstagramFeed />);

    expect(screen.getAllByTestId("instagram-post")).toHaveLength(2);
    expect(screen.getAllByTestId("instagram-post-link")[0]).toHaveAttribute(
      "href",
      "https://www.instagram.com/p/AAA111/",
    );
    expect(
      screen.getByAltText("A finished dress, ready for Nationals"),
    ).toBeInTheDocument();
    expect(screen.getByAltText("Second piece")).toBeInTheDocument();
  });

  it("offers a shop link only on a post the atelier tied to a piece", () => {
    stubHook(mockHook as never, {
      data: {
        posts: [
          post({ productId: "row-1", productTitle: "Aurora Soaker" }),
          post({ id: "media-2" }),
        ],
      },
    });

    render(<InstagramFeed />);

    const shop = screen.getAllByTestId("instagram-post-shop");
    expect(shop).toHaveLength(1);
    expect(shop[0]).toHaveAttribute("href", "/shop/row-1");
    expect(shop[0]).toHaveTextContent("Shop Aurora Soaker");
  });

  it("keeps the shop link out of the Instagram anchor", () => {
    // An anchor inside an anchor is invalid markup and leaves the inner link
    // unreachable by keyboard in some browsers.
    stubHook(mockHook as never, {
      data: { posts: [post({ productId: "row-1", productTitle: "Aurora" })] },
    });

    render(<InstagramFeed />);

    const outer = screen.getByTestId("instagram-post-link");
    expect(outer).not.toContainElement(
      screen.getByTestId("instagram-post-shop"),
    );
  });

  it("shows only as many tiles as asked for", () => {
    stubHook(mockHook as never, {
      data: { posts: [post(), post({ id: "2" }), post({ id: "3" })] },
    });

    render(<InstagramFeed limit={2} />);

    expect(screen.getAllByTestId("instagram-post")).toHaveLength(2);
  });

  it("drops a tile whose image fails to load", () => {
    // Instagram's CDN URLs are signed and do expire; a grid of the atelier's
    // work is the last place a broken-image icon should appear.
    stubHook(mockHook as never, {
      data: { posts: [post(), post({ id: "media-2" })] },
    });

    render(<InstagramFeed />);
    fireEvent.error(screen.getAllByRole("img")[0]);

    expect(screen.getAllByTestId("instagram-post")).toHaveLength(1);
  });

  it("renders nothing once every image has failed", () => {
    stubHook(mockHook as never, { data: { posts: [post()] } });

    const { container } = render(<InstagramFeed />);
    fireEvent.error(screen.getByRole("img"));

    expect(container).toBeEmptyDOMElement();
  });

  // The section is optional garnish on pages that stand on their own, so every
  // non-happy path renders nothing rather than a hole or an empty state — the
  // same contract as <Testimonials />.
  it.each([
    ["there are no posts", { data: { posts: [] } }],
    ["the request is still loading", { isLoading: true }],
    ["the request failed", { isError: true }],
  ])("renders nothing when %s", (_label, state) => {
    stubHook(mockHook as never, state);

    const { container } = render(<InstagramFeed />);

    expect(screen.queryByTestId("instagram-feed")).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });
});
