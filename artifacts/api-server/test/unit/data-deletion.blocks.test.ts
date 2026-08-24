import { describe, it, expect } from "vitest";
import {
  DATA_DELETION_REQUEST_TYPE,
  buildDataDeletionProperties,
} from "../../src/lib/notion/data-deletion.blocks.js";
import {
  CONTACT_CLIENT_PROPERTY,
  CONTACT_DEFAULT_STAGE,
  CONTACT_MESSAGE_PROPERTY,
  CONTACT_STAGE_PROPERTY,
  CONTACT_SUBJECT_PROPERTY,
  CONTACT_TYPE_PROPERTY,
} from "../../src/lib/notion/contact.blocks.js";

const base = {
  email: "ada@example.com",
  marketing: "unsubscribed" as const,
};

/** The row's message body as one string, for asserting on its copy. */
function messageOf(properties: Record<string, unknown>): string {
  const property = properties[CONTACT_MESSAGE_PROPERTY] as {
    rich_text: Array<{ text: { content: string } }>;
  };
  return property.rich_text.map((t) => t.text.content).join("");
}

describe("buildDataDeletionProperties", () => {
  it("tags the row as a deletion request and files it as new", () => {
    const properties = buildDataDeletionProperties(base);

    expect(properties[CONTACT_TYPE_PROPERTY]).toEqual({
      select: { name: DATA_DELETION_REQUEST_TYPE },
    });
    expect(properties[CONTACT_STAGE_PROPERTY]).toEqual({
      select: { name: CONTACT_DEFAULT_STAGE },
    });
    expect(properties[CONTACT_SUBJECT_PROPERTY]).toEqual({
      title: [{ text: { content: "Data deletion: ada@example.com" } }],
    });
  });

  it("carries the sign-in account id, the one handle the app can't delete itself", () => {
    const message = messageOf(
      buildDataDeletionProperties({ ...base, userId: "user-abc" }),
    );
    expect(message).toContain("Sign-in account id: user-abc");
  });

  it("omits the account id line when the session carried none", () => {
    expect(messageOf(buildDataDeletionProperties(base))).not.toContain(
      "Sign-in account id",
    );
  });

  it("says what the app already did about the mailing list", () => {
    expect(messageOf(buildDataDeletionProperties(base))).toContain(
      "removed from the marketing audience by the app",
    );
    expect(
      messageOf(buildDataDeletionProperties({ ...base, marketing: "absent" })),
    ).toContain("was not on the marketing audience");
  });

  it("says plainly when the mailing list is still the atelier's to do", () => {
    const message = messageOf(
      buildDataDeletionProperties({ ...base, marketing: "unavailable" }),
    );
    expect(message).toContain("NOT done");
    expect(message).toContain("remove them by hand");
  });

  it("states on the row itself that nothing else has been deleted", () => {
    expect(messageOf(buildDataDeletionProperties(base))).toContain(
      "Nothing else has been deleted.",
    );
  });

  it("renders an em dash for a customer who left no note", () => {
    expect(messageOf(buildDataDeletionProperties(base))).toContain(
      "Their note: —",
    );
    expect(
      messageOf(buildDataDeletionProperties({ ...base, note: "Keep ORD-1" })),
    ).toContain("Their note: Keep ORD-1");
  });

  it("links the Client CRM record when one was resolved, and omits it otherwise", () => {
    expect(
      buildDataDeletionProperties(base, "client-page")[CONTACT_CLIENT_PROPERTY],
    ).toEqual({ relation: [{ id: "client-page" }] });
    expect(buildDataDeletionProperties(base)).not.toHaveProperty(
      CONTACT_CLIENT_PROPERTY,
    );
  });
});
