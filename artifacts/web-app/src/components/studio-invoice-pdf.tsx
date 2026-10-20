// The invoice PDF, previewed on the studio dashboard.
//
// This is the "look at it" half of the Invoice PDF tool card: the server renders
// the document exactly as the customer downloads it (the same layout code, fed
// the same invoice view), and this component shows it in place and offers it to
// download. Saving a copy to Notion is the tool run on the card itself — a
// preview changes nothing, so it deliberately isn't a tool with a result.
//
// The bytes arrive as a Blob and are shown through an object URL in a frame.
// It's our own server's PDF on our own origin, so no sandbox is needed (unlike
// the how-to guides, which are files somebody uploaded); the URL is revoked when
// a newer preview replaces it or the card unmounts, so a long dashboard session
// doesn't hold every document it ever showed in memory.

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { fetchInvoicePdf } from "@/lib/studio-invoice-pdf";
import { Loader2, FileText, Download, ExternalLink } from "lucide-react";

interface PreviewedPdf {
  orderNumber: string;
  filename: string;
  url: string;
}

export function InvoicePdfPreview({ orderNumber }: { orderNumber: string }) {
  const [preview, setPreview] = useState<PreviewedPdf | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subject = orderNumber.trim();

  // Release the object URL whenever it stops being the one on screen.
  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview.url);
  }, [preview]);

  const load = async () => {
    if (!subject || loading) return;
    setLoading(true);
    setError(null);
    try {
      const file = await fetchInvoicePdf(subject);
      setPreview({
        orderNumber: subject,
        filename: file.filename,
        url: URL.createObjectURL(file.blob),
      });
    } catch (err) {
      setPreview(null);
      setError(
        err instanceof Error && err.message
          ? err.message
          : "Couldn't load the invoice PDF. Please try again in a moment.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-3" data-testid="invoice-pdf-preview">
      <Button
        type="button"
        variant="outline"
        onClick={load}
        disabled={!subject || loading}
        className="w-full gap-2 sm:w-auto"
        data-testid="invoice-pdf-preview-open"
      >
        {loading ? (
          <Loader2 className="w-4 h-4 animate-spin" strokeWidth={1.5} />
        ) : (
          <FileText className="w-4 h-4" strokeWidth={1.5} />
        )}
        Preview PDF
      </Button>

      {error && (
        <p
          className="mt-3 text-sm text-destructive"
          data-testid="invoice-pdf-preview-error"
        >
          {error}
        </p>
      )}

      {preview && (
        <div className="mt-4" data-testid="invoice-pdf-preview-document">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs tracking-[0.15em] uppercase text-muted-foreground">
              Invoice {preview.orderNumber} · as the customer downloads it
            </p>
            <div className="flex gap-3 text-xs tracking-widest uppercase">
              <a
                href={preview.url}
                download={preview.filename}
                className="inline-flex items-center gap-1 text-muted-foreground hover:text-primary transition-colors"
                data-testid="invoice-pdf-preview-download"
              >
                <Download className="w-3.5 h-3.5" strokeWidth={1.5} />
                Download
              </a>
              <a
                href={preview.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-muted-foreground hover:text-primary transition-colors"
                data-testid="invoice-pdf-preview-open-tab"
              >
                <ExternalLink className="w-3.5 h-3.5" strokeWidth={1.5} />
                Open in a new tab
              </a>
            </div>
          </div>
          <iframe
            title={`Invoice ${preview.orderNumber} PDF`}
            src={preview.url}
            className="mt-3 h-[36rem] w-full rounded-sm border border-border bg-white"
            data-testid="invoice-pdf-preview-frame"
          />
        </div>
      )}
    </div>
  );
}
