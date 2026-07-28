import { describe, it, expect } from "vitest";
import { newsletterInput } from "@workspace/test-fixtures";
import {
  buildNewsletterProperties,
  type CreateNewsletterInput,
} from "../../src/lib/notion/newsletter.blocks.js";

const baseRequest: CreateNewsletterInput = newsletterInput();

describe("buildNewsletterProperties", () => {
  it("maps each field to the correct live Notion property type", () => {
    const props = buildNewsletterProperties(baseRequest) as any;

    // title — names the opt-in (with its source), so the inbox row reads alone
    expect(props["Message (subject)"].title[0].text.content).toBe(
      "Newsletter opt-in — footer",
    );
    // email property (not rich_text)
    expect(props.Email).toEqual({ email: "grace@example.com" });
    // select, defaulted to "New" — same triage stage as any inbox row
    expect(props.Stage).toEqual({ select: { name: "New" } });
  });

  it("names the opt-in without a source when none is given", () => {
    const props = buildNewsletterProperties(
      newsletterInput({ source: undefined }),
    ) as any;
    expect(props["Message (subject)"].title[0].text.content).toBe(
      "Newsletter opt-in",
    );
  });

  it("links to the Client CRM record when a client page id is given", () => {
    const props = buildNewsletterProperties(baseRequest, "client-9") as any;
    expect(props.Client).toEqual({ relation: [{ id: "client-9" }] });
  });

  it("omits the Client relation when no client page id is given", () => {
    const props = buildNewsletterProperties(baseRequest) as any;
    expect(props).not.toHaveProperty("Client");
  });
});

// The newsletter opt-in shares the "Website Contact Messages" database with the
// other writers, so the "Request type" that separates it in the inbox is
// load-bearing.
describe("Request type marks the row as a newsletter opt-in", () => {
  it("tags the row Newsletter", () => {
    const props = buildNewsletterProperties(baseRequest) as any;
    expect(props["Request type"]).toEqual({ select: { name: "Newsletter" } });
  });
});
