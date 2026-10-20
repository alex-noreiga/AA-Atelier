// The invoice PDF preview over the real Express stack.
//
// A binary route outside the OpenAPI contract, so what's checked here is the
// part the generated schemas don't cover: that the staff gate is mounted on it,
// that the bytes come back as a PDF the browser can show in place, and that a
// refusal from the service still arrives as the JSON error envelope the
// dashboard knows how to read. The renderer itself has its own unit suite.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/services/invoice-pdf.service.js", () => ({
  renderInvoicePdf: vi.fn(),
}));

import request from "supertest";
import app from "../../src/app.js";
import { renderInvoicePdf } from "../../src/services/invoice-pdf.service.js";
import { BadRequestError } from "../../src/lib/errors.js";
import {
  __setSupabaseClientForTests,
  __resetSupabaseClient,
} from "../../src/lib/supabase/client.js";
import {
  makeFakeSupabaseClient,
  asSupabaseClient,
  type FakeClaims,
} from "../support/fake-supabase.js";

const mockRender = vi.mocked(renderInvoicePdf);

const STAFF = "alexandra@a3iceanddance.com";
const TOKEN = "staff-token";

const GOOGLE_STAFF: FakeClaims = {
  email: STAFF,
  sub: "user-1",
  amr: [{ method: "oauth", timestamp: 1_700_000_000 }],
};

const PDF_BYTES = Buffer.from("%PDF-1.3 fake invoice");

beforeEach(() => {
  process.env.SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_ANON_KEY = "anon-test-key";
  process.env.STUDIO_STAFF_EMAILS = STAFF;
  delete process.env.STUDIO_REQUIRE_GOOGLE;
  __setSupabaseClientForTests(
    asSupabaseClient(
      makeFakeSupabaseClient((token) =>
        token === TOKEN
          ? { data: { claims: GOOGLE_STAFF }, error: null }
          : { data: null, error: { message: "invalid token" } },
      ),
    ),
  );
  mockRender.mockResolvedValue({
    orderNumber: "ORD-000002",
    orderName: "Ada – Custom Costume",
    invoiceId: "ORD-000002",
    filename: "AA-Atelier-Invoice-ORD-000002.pdf",
    contentType: "application/pdf",
    bytes: PDF_BYTES,
    lineCount: 3,
    balanceDue: 145,
    paid: false,
  });
});

afterEach(() => {
  __resetSupabaseClient();
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  delete process.env.STUDIO_STAFF_EMAILS;
});

const ENDPOINT = "/api/studio/invoices/ORD-000002/pdf";

describe("GET /api/studio/invoices/:orderNumber/pdf", () => {
  it("401s an anonymous caller without rendering anything", async () => {
    const res = await request(app).get(ENDPOINT);
    expect(res.status).toBe(401);
    expect(mockRender).not.toHaveBeenCalled();
  });

  it("serves the PDF inline to a staff member", async () => {
    const res = await request(app)
      .get(ENDPOINT)
      .set("Authorization", `Bearer ${TOKEN}`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toBe(
      'inline; filename="AA-Atelier-Invoice-ORD-000002.pdf"',
    );
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(Buffer.from(res.body as Buffer).equals(PDF_BYTES)).toBe(true);
    expect(mockRender).toHaveBeenCalledWith("ORD-000002");
  });

  it("relays the service's reason as the JSON error envelope", async () => {
    mockRender.mockRejectedValue(
      new BadRequestError("Invoice ORD-000002 isn't marked ready yet."),
    );

    const res = await request(app)
      .get(ENDPOINT)
      .set("Authorization", `Bearer ${TOKEN}`);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: "Invoice ORD-000002 isn't marked ready yet.",
    });
  });
});
