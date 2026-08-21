import { describe, it, expect } from "vitest";
import {
  contactInput,
  notifyInput,
  newsletterInput,
  measurementChangeInput,
  returnRequestInput,
} from "@workspace/test-fixtures";
import { createContactMessage } from "../../src/lib/notion/contact.repository.js";
import { createBackInStockRequest } from "../../src/lib/notion/notify.repository.js";
import { createCancellationRequest } from "../../src/lib/notion/cancellation.repository.js";
import { createNewsletterSubscription } from "../../src/lib/notion/newsletter.repository.js";
import { createMeasurementChangeRequest } from "../../src/lib/notion/measurement-change.repository.js";
import { createReturnRequest } from "../../src/lib/notion/return-request.repository.js";
import {
  makeFakeClient,
  jsonResponse,
  errorResponse,
} from "../support/fake-notion.js";

// The six writers into "Website Contact Messages" all go through one shared
// write path (`contactDatabaseWriter`), so they are covered here once rather
// than in six near-identical files. Each row below binds a real writer to the
// fixture it takes, the "Request type" it must stamp, and the noun its errors
// are named for — the three things that actually differ between them.
//
// The route tests mock these repositories out, so this is still the only place
// the Notion request shape and error handling are covered.
//
// Note the `Request type` assertion applies to every writer here. Only the
// cancellation file used to check it, yet it is the property that separates the
// six request types inside the one shared inbox — get it wrong and the atelier's
// filtered views silently stop matching.

/** One writer, invoked with a row of whatever shape it takes. */
type WriterCase = {
  name: string;
  /** `label` in the shared writer, i.e. the noun phrase in the thrown message. */
  errorNoun: string;
  /** The `Request type` select value this writer must stamp on its row. */
  requestType: string;
  send: (client: Parameters<typeof createContactMessage>[1]) => Promise<void>;
};

const WRITERS: WriterCase[] = [
  {
    name: "createContactMessage",
    errorNoun: "contact-message",
    requestType: "Inquiry",
    send: (client) =>
      createContactMessage(
        contactInput({ name: "Grace Hopper", email: "grace@example.com" }),
        client,
      ),
  },
  {
    name: "createBackInStockRequest",
    errorNoun: "back-in-stock request",
    requestType: "Back in stock",
    send: (client) =>
      createBackInStockRequest(
        notifyInput({ item: "Bow Fleece Soaker — Black", size: "M" }),
        client,
      ),
  },
  {
    name: "createCancellationRequest",
    errorNoun: "cancellation request",
    requestType: "Cancellation",
    send: (client) =>
      createCancellationRequest(
        {
          orderNumber: "ORD-1",
          orderType: "custom",
          emailVerified: true,
          email: "ada@example.com",
        },
        client,
      ),
  },
  {
    name: "createNewsletterSubscription",
    errorNoun: "newsletter subscription",
    requestType: "Newsletter",
    send: (client) => createNewsletterSubscription(newsletterInput(), client),
  },
  {
    name: "createMeasurementChangeRequest",
    errorNoun: "measurement-change request",
    requestType: "Measurement update",
    send: (client) =>
      createMeasurementChangeRequest(
        {
          orderNumber: "000002",
          emailVerified: true,
          request: measurementChangeInput(),
        },
        client,
      ),
  },
  {
    name: "createReturnRequest",
    errorNoun: "return request",
    requestType: "Return / exchange",
    send: (client) =>
      createReturnRequest(
        {
          orderNumber: "SHP-ABC-1234",
          emailVerified: true,
          request: returnRequestInput(),
        },
        client,
      ),
  },
];

describe.each(WRITERS)(
  "$name (contact database writer)",
  ({ errorNoun, requestType, send }) => {
    it("throws when the contact database id is not configured", async () => {
      const client = makeFakeClient(() => jsonResponse({}), "");
      await expect(send(client)).rejects.toThrow(
        /NOTION_CONTACT_DATABASE_ID is not configured/,
      );
    });

    it("POSTs a page parented to the contact database, tagged with its request type", async () => {
      const client = makeFakeClient((path) => {
        if (path === "/v1/pages") return jsonResponse({ id: "new-page" }, 200);
        throw new Error(`unexpected path ${path}`);
      });

      await send(client);

      expect(client.calls).toHaveLength(1);
      const call = client.calls[0];
      expect(call.path).toBe("/v1/pages");
      expect(call.init?.method).toBe("POST");
      const body = JSON.parse(call.init!.body as string);
      expect(body.parent).toEqual({ database_id: "test-db-id" });
      expect(body.properties).toBeDefined();
      expect(body.properties["Request type"]).toEqual({
        select: { name: requestType },
      });
    });

    it("throws with the status and Notion error text on a non-ok response", async () => {
      const client = makeFakeClient(() =>
        errorResponse(400, "validation_error: bad property"),
      );
      await expect(send(client)).rejects.toThrow(
        new RegExp(
          `Notion ${errorNoun} creation failed with status 400: validation_error: bad property`,
        ),
      );
    });
  },
);

// Each writer must stamp a DISTINCT request type, or two of them would land
// indistinguishably in the shared inbox. Asserted once over the table rather
// than per writer, because it is a property of the set, not of any one member.
it("gives each writer its own Request type", () => {
  const types = WRITERS.map((w) => w.requestType);
  expect(new Set(types).size).toBe(types.length);
});
