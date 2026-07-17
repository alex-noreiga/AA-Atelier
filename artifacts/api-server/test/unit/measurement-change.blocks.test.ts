import { describe, it, expect } from "vitest";
import { measurementChangeInput } from "@workspace/test-fixtures";
import {
  buildMeasurementChangeProperties,
  type MeasurementChangeRow,
} from "../../src/lib/notion/measurement-change.blocks.js";

function row(
  overrides: Partial<MeasurementChangeRow> = {},
): MeasurementChangeRow {
  return {
    orderNumber: "000002",
    emailVerified: true,
    request: measurementChangeInput(),
    ...overrides,
  };
}

describe("buildMeasurementChangeProperties", () => {
  it("maps each field to the correct live contact-database property type", () => {
    const props = buildMeasurementChangeProperties(row()) as any;

    // title — names the order so the inbox row reads on its own
    expect(props["Message (subject)"].title[0].text.content).toBe(
      "Measurement update: 000002",
    );
    // email property (not rich_text)
    expect(props.Email).toEqual({ email: "ada@example.com" });
    // select, defaulted to "New" — same triage stage as any inbox message
    expect(props.Stage).toEqual({ select: { name: "New" } });
  });

  it("tags the row as a measurement-change request (separates it in the inbox)", () => {
    const props = buildMeasurementChangeProperties(row()) as any;
    expect(props["Request type"]).toEqual({
      select: { name: "Measurement update" },
    });
  });

  it("writes the requested measurements, unit, and note into the message body", () => {
    const props = buildMeasurementChangeProperties(
      row({
        request: measurementChangeInput({
          measurementUnit: "cm",
          waist: 74,
          note: "Please widen the waist a touch.",
        }),
      }),
    ) as any;

    const message = props.Message.rich_text[0].text.content as string;
    expect(message).toContain("order 000002");
    expect(message).toContain("Requested measurements (cm):");
    expect(message).toContain("Waist: 74");
    expect(message).toContain("Note: Please widen the waist a touch.");
  });

  it("shows an em dash when no note is provided", () => {
    const props = buildMeasurementChangeProperties(row()) as any;
    const message = props.Message.rich_text[0].text.content as string;
    expect(message).toContain("Note: —");
  });

  it("names a re-measure appointment instead of values when requested", () => {
    const props = buildMeasurementChangeProperties(
      row({
        request: measurementChangeInput({ measurementAppointment: true }),
      }),
    ) as any;

    const message = props.Message.rich_text[0].text.content as string;
    expect(message).toContain(
      "Requested: re-measurement at a fitting or consultation appointment.",
    );
    expect(message).not.toContain("Requested measurements");
  });

  it("flags whether the email was verified so the atelier can confirm legacy orders", () => {
    const verified = buildMeasurementChangeProperties(
      row({ emailVerified: true }),
    ) as any;
    expect(verified.Message.rich_text[0].text.content).toContain(
      "Email verified: yes (ada@example.com)",
    );

    const unverified = buildMeasurementChangeProperties(
      row({ emailVerified: false }),
    ) as any;
    expect(unverified.Message.rich_text[0].text.content).toContain(
      "Email verified: no (confirm requester) (ada@example.com)",
    );
  });

  it("links to the Client CRM record when a client page id is given", () => {
    const props = buildMeasurementChangeProperties(row(), "client-3") as any;
    expect(props.Client).toEqual({ relation: [{ id: "client-3" }] });
  });

  it("omits the Client relation when no client page id is given", () => {
    const props = buildMeasurementChangeProperties(row()) as any;
    expect(props).not.toHaveProperty("Client");
  });
});
