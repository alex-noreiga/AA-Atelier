import { describe, it, expect } from "vitest";
import { createOrderInput } from "@workspace/test-fixtures";
import {
  makeFakeClient,
  jsonResponse,
  errorResponse,
} from "../support/fake-notion.js";
import { linkOrderFormSubmission } from "../../src/lib/notion/order-form-submissions.repository.js";

describe("linkOrderFormSubmission", () => {
  it("returns null without touching Notion when the hub db id is unset", async () => {
    const client = makeFakeClient(() => {
      throw new Error("should not fetch");
    }, "");
    expect(
      await linkOrderFormSubmission(createOrderInput(), "order-1", client),
    ).toBeNull();
    expect(client.calls).toHaveLength(0);
  });

  it("returns null without touching Notion when no order page id is given", async () => {
    const client = makeFakeClient(() => {
      throw new Error("should not fetch");
    });
    expect(
      await linkOrderFormSubmission(createOrderInput(), "", client),
    ).toBeNull();
    expect(client.calls).toHaveLength(0);
  });

  it("creates a submission linked to the order with contact + measurements", async () => {
    const client = makeFakeClient((path) => {
      if (path === "/v1/pages") return jsonResponse({ id: "sub-1" }, 200);
      throw new Error(`unexpected ${path}`);
    });

    const id = await linkOrderFormSubmission(
      createOrderInput({
        fullName: "Ada Lovelace",
        email: "ada@example.com",
        phone: "555-0100",
      }),
      "order-page-42",
      client,
    );

    expect(id).toBe("sub-1");
    const body = JSON.parse(client.calls[0].init!.body as string);
    expect(body.parent).toEqual({ database_id: "test-db-id" });
    expect(body.properties["Name"].title[0].text.content).toBe("Ada Lovelace");
    expect(body.properties["Email"].email).toBe("ada@example.com");
    expect(body.properties["Phone Number"].phone_number).toBe("555-0100");
    // The relation back to the order is the load-bearing link.
    expect(body.properties["Order Tracking Pipeline"].relation).toEqual([
      { id: "order-page-42" },
    ]);
    // The five body measurements are summarized with their unit.
    expect(body.properties["Measurements"].rich_text[0].text.content).toContain(
      "Waist 28",
    );
    expect(body.properties["Measurements"].rich_text[0].text.content).toContain(
      "(inches)",
    );
  });

  it("records the appointment note when measurements will be taken at a fitting", async () => {
    const client = makeFakeClient(() => jsonResponse({ id: "sub-2" }));
    const { waist, bust, hips, height, bodyGirth, measurementUnit, ...contact } =
      createOrderInput();

    await linkOrderFormSubmission(
      { ...contact, measurementAppointment: true },
      "order-1",
      client,
    );

    const body = JSON.parse(client.calls[0].init!.body as string);
    expect(body.properties["Measurements"].rich_text[0].text.content).toMatch(
      /fitting or consultation/,
    );
  });

  it("includes description and Target Date when provided, omits them otherwise", async () => {
    const client = makeFakeClient(() => jsonResponse({ id: "sub-3" }));

    await linkOrderFormSubmission(
      createOrderInput({
        description: "Sapphire velvet, sweetheart neckline",
        neededBy: new Date("2026-09-01"),
      }),
      "order-1",
      client,
    );

    const body = JSON.parse(client.calls[0].init!.body as string);
    expect(
      body.properties[
        "Please describe what you want your custom dress to look like"
      ].rich_text[0].text.content,
    ).toBe("Sapphire velvet, sweetheart neckline");
    expect(body.properties["Target Date"].date.start).toBe("2026-09-01");
  });

  it("attaches uploaded reference images as external files, named from their URLs", async () => {
    const client = makeFakeClient(() => jsonResponse({ id: "sub-4" }));

    await linkOrderFormSubmission(
      createOrderInput({
        imageUrls: [
          "https://x.blob.vercel-storage.com/order-references/sketch-a1b2.png",
          "https://x.blob.vercel-storage.com/order-references/clip.mp4",
        ],
      }),
      "order-1",
      client,
    );

    const body = JSON.parse(client.calls[0].init!.body as string);
    const files =
      body.properties[
        "Please attach any images/video references you have for your dress"
      ].files;
    expect(files).toHaveLength(2);
    expect(files[0]).toEqual({
      type: "external",
      name: "sketch-a1b2.png",
      external: {
        url: "https://x.blob.vercel-storage.com/order-references/sketch-a1b2.png",
      },
    });
    expect(files[1].name).toBe("clip.mp4");
  });

  it("omits the files property when no images were uploaded", async () => {
    const client = makeFakeClient(() => jsonResponse({ id: "sub-5" }));
    await linkOrderFormSubmission(createOrderInput(), "order-1", client);
    const body = JSON.parse(client.calls[0].init!.body as string);
    expect(body.properties).not.toHaveProperty(
      "Please attach any images/video references you have for your dress",
    );
  });

  it("throws on a non-ok Notion response", async () => {
    const client = makeFakeClient(() => errorResponse(400, "bad property"));
    await expect(
      linkOrderFormSubmission(createOrderInput(), "order-1", client),
    ).rejects.toThrow(/status 400: bad property/);
  });
});
