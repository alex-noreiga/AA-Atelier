import { describe, it, expect } from "vitest";
import { contactInput, notifyInput } from "@workspace/test-fixtures";
import { buildContactProperties } from "../../src/lib/notion/contact.blocks.js";
import {
  buildNotifyProperties,
  type CreateNotifyInput,
} from "../../src/lib/notion/notify.blocks.js";

const baseRequest: CreateNotifyInput = notifyInput();

describe("buildNotifyProperties", () => {
  it("maps each field to the correct live Notion property type", () => {
    const props = buildNotifyProperties(baseRequest) as any;

    // title — names the piece, so the inbox row reads on its own
    expect(props["Message (subject)"].title[0].text.content).toBe(
      "Back in stock: Bow Fleece Soaker — Black",
    );
    // email property (not rich_text)
    expect(props.Email).toEqual({ email: "grace@example.com" });
    // rich_text — the item as a real property, not buried in message text
    expect(props.Item.rich_text[0].text.content).toBe(
      "Bow Fleece Soaker — Black",
    );
    // select, defaulted to "New" — same triage stage as any inbox message
    expect(props.Stage).toEqual({ select: { name: "New" } });
  });

  it("omits the Size property when the whole variant is sold out", () => {
    const props = buildNotifyProperties(baseRequest) as any;
    expect(props).not.toHaveProperty("Size");
  });

  it("records the size, and names it in the subject, for a per-size request", () => {
    const props = buildNotifyProperties(
      notifyInput({ size: "Adult S" }),
    ) as any;

    expect(props.Size.rich_text[0].text.content).toBe("Adult S");
    expect(props["Message (subject)"].title[0].text.content).toBe(
      "Back in stock: Bow Fleece Soaker — Black — Adult S",
    );
  });
});

// Both writers share the "Website Contact Messages" database, so the property
// that separates them in the inbox is load-bearing — assert it from both sides.
describe("Request type separates the two writers to the contact database", () => {
  it("tags a back-in-stock request as such", () => {
    const props = buildNotifyProperties(baseRequest) as any;
    expect(props["Request type"]).toEqual({
      select: { name: "Back in stock" },
    });
  });

  it("tags a contact-form message as an inquiry", () => {
    const props = buildContactProperties(contactInput()) as any;
    expect(props["Request type"]).toEqual({ select: { name: "Inquiry" } });
  });
});
