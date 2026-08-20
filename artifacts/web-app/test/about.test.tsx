import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useGetPublishedReviews } from "@workspace/api-client-react";
import About from "@/pages/about";
import { stubHook } from "./support/mock-hook";

// The page's own copy is static; the one thing it fetches is the curated
// testimonial strip. Stubbed empty here so these cases stay about the story and
// the FAQ — the strip's own behavior is covered in testimonials.test.tsx.
vi.mock("@workspace/api-client-react", () => ({
  useGetPublishedReviews: vi.fn(),
}));

beforeEach(() => {
  stubHook(vi.mocked(useGetPublishedReviews) as never, {
    data: { reviews: [] },
  });
});

const FIRST_QUESTION = "How long does a custom costume take?";
const SECOND_QUESTION = "How do I get measured?";

/** The accordion trigger for a question. */
const question = (name: string) => screen.getByRole("button", { name });

/** The revealed answer panel for an open question, or null when collapsed. */
const answerFor = (name: string) =>
  screen.queryByRole("region", { name: new RegExp(name, "i") });

describe("About", () => {
  it("renders the page heading and every FAQ question", () => {
    render(<About />);

    expect(screen.getByRole("heading", { name: "About" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Frequently asked" }),
    ).toBeInTheDocument();
    const faq = within(screen.getByTestId("faq-section"));
    expect(faq.getAllByRole("button")).toHaveLength(8);
    expect(faq.getByRole("button", { name: FIRST_QUESTION })).toBeVisible();
    expect(faq.getByRole("button", { name: SECOND_QUESTION })).toBeVisible();
  });

  it("keeps every answer collapsed until its question is clicked", async () => {
    render(<About />);

    expect(answerFor(FIRST_QUESTION)).not.toBeInTheDocument();

    await userEvent.click(question(FIRST_QUESTION));

    expect(answerFor(FIRST_QUESTION)).toBeVisible();
    expect(answerFor(FIRST_QUESTION)).toHaveTextContent(/four to eight weeks/i);
  });

  it("closes the open answer when another question is opened", async () => {
    render(<About />);

    await userEvent.click(question(FIRST_QUESTION));
    await userEvent.click(question(SECOND_QUESTION));

    expect(answerFor(SECOND_QUESTION)).toBeVisible();
    expect(answerFor(FIRST_QUESTION)).not.toBeInTheDocument();
  });

  it("collapses an open answer when its own question is clicked again", async () => {
    render(<About />);

    await userEvent.click(question(FIRST_QUESTION));
    await userEvent.click(question(FIRST_QUESTION));

    expect(answerFor(FIRST_QUESTION)).not.toBeInTheDocument();
  });
});
