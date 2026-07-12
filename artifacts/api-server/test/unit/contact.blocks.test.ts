import { describe, it, expect } from "vitest";
import {
  buildContactProperties,
  type CreateContactInput,
} from "../../src/lib/notion/contact.blocks.js";

const baseContact: CreateContactInput = {
  name: "Grace Hopper",
  email: "grace@example.com",
  message: "Do you ship internationally?",
};

describe("buildContactProperties", () => {
  it("maps each field to the correct live Notion property type", () => {
    const props = buildContactProperties(baseContact) as any;

    // title
    expect(props["Message (subject)"].title[0].text.content).toBe(
      "Grace Hopper – Website inquiry",
    );
    // rich_text
    expect(props["Customer name"].rich_text[0].text.content).toBe(
      "Grace Hopper",
    );
    // email property (not rich_text)
    expect(props.Email).toEqual({ email: "grace@example.com" });
    // rich_text
    expect(props.Message.rich_text[0].text.content).toBe(
      "Do you ship internationally?",
    );
    // select, defaulted to "New"
    expect(props.Stage).toEqual({ select: { name: "New" } });
  });

  it("omits the Phone property when no phone is provided", () => {
    const props = buildContactProperties(baseContact) as any;
    expect(props).not.toHaveProperty("Phone");
  });

  it("sets the Phone property as phone_number when provided", () => {
    const props = buildContactProperties({
      ...baseContact,
      phone: "+1 555 987 6543",
    }) as any;
    expect(props.Phone).toEqual({ phone_number: "+1 555 987 6543" });
  });
});
