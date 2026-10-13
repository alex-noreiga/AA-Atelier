// Fetches the server-rendered invoice PDF for the studio dashboard's preview.
//
// This bypasses the generated api-client on purpose: that client is JSON-only,
// and `GET /api/studio/invoices/:orderNumber/pdf` answers with the PDF bytes —
// a binary route outside the OpenAPI contract, like the reference-image upload
// (`lib/reference-images.ts`). The one thing it must do that the generated
// client does for free is carry the Supabase access token, since the route sits
// behind the same `requireStaff` gate as the rest of `/api/studio/*`.

import { invoiceFilename } from "@workspace/documents/filenames";
import { supabase } from "@/lib/supabase";

/** A fetched invoice PDF, ready to show or download. */
export interface InvoicePdfFile {
  blob: Blob;
  /** The download filename — the same one the customer's download uses. */
  filename: string;
}

/** The `filename="…"` of a Content-Disposition header, if it carries one. */
export function filenameFromDisposition(
  header: string | null,
): string | undefined {
  const match = /filename="([^"]+)"/.exec(header ?? "");
  return match?.[1] || undefined;
}

/**
 * Fetch an order's invoice PDF as the signed-in staff member. Throws an `Error`
 * whose message is written to be shown — the server's own reason when it gave
 * one (the invoice isn't ready, the order doesn't exist), else a generic one.
 */
export async function fetchInvoicePdf(
  orderNumber: string,
): Promise<InvoicePdfFile> {
  const trimmed = orderNumber.trim();
  const headers: Record<string, string> = {};
  if (supabase) {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(
    `/api/studio/invoices/${encodeURIComponent(trimmed)}/pdf`,
    { headers },
  );

  if (!response.ok) {
    let message =
      response.status === 401
        ? "Your session has expired. Sign in again to preview the invoice."
        : "Couldn't load the invoice PDF. Please try again in a moment.";
    try {
      const data = (await response.json()) as { error?: string };
      if (data?.error) message = data.error;
    } catch {
      // Non-JSON error body — keep the generic message.
    }
    throw new Error(message);
  }

  return {
    blob: await response.blob(),
    filename:
      filenameFromDisposition(response.headers.get("Content-Disposition")) ??
      invoiceFilename(trimmed),
  };
}
