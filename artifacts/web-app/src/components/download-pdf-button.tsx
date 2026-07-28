import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/**
 * A "Download PDF" button that runs an async download action, showing a spinner
 * while it works and a toast if it throws. Callers pass an `onDownload` that
 * dynamically imports the relevant PDF builder, so jsPDF is code-split into its
 * own chunk and never loads until someone actually asks for a download.
 */
export function DownloadPdfButton({
  onDownload,
  label = "Download PDF",
  className,
}: {
  onDownload: () => void | Promise<void>;
  label?: string;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  const handleClick = async () => {
    setBusy(true);
    try {
      await onDownload();
    } catch {
      toast({
        variant: "destructive",
        title: "Couldn't create the PDF",
        description: "Something went wrong. Please try again.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      onClick={handleClick}
      disabled={busy}
      className={cn(
        "rounded-full px-6 py-5 tracking-widest uppercase text-xs",
        className,
      )}
      data-testid="button-download-pdf"
    >
      {busy ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        <Download className="w-4 h-4" />
      )}
      {label}
    </Button>
  );
}
