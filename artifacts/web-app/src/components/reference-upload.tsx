import { useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Upload, X, Paperclip } from "lucide-react";

export interface UploadedReference {
  name: string;
  url: string;
}

// Cap each upload so a misconfigured Blob store (the token route 503s and the SDK
// retries) or a stalled network can't leave the field spinning forever.
const UPLOAD_TIMEOUT_MS = 60_000;

function describeUploadError(err: unknown): string {
  if (err instanceof Error && err.name === "AbortError") {
    return "The upload timed out — please check your connection and try again. If it keeps happening, uploads may not be enabled yet.";
  }
  return (
    (err as Error)?.message ||
    "We couldn't upload that file. Please try again."
  );
}

/**
 * Reference image/video uploader for the order form. Files upload directly from
 * the browser to Vercel Blob (via the `/api/uploads/order-refs` token route),
 * bypassing the serverless request-body limit; the resulting URLs are lifted to
 * the parent so they ride along in the order submission as `imageUrls`.
 */
export function ReferenceUpload({
  value,
  onChange,
  disabled,
}: {
  value: UploadedReference[];
  onChange: (refs: UploadedReference[]) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const { toast } = useToast();

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    const uploaded: UploadedReference[] = [];
    try {
      for (const file of Array.from(files)) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
        try {
          const result = await upload(`order-references/${file.name}`, file, {
            access: "public",
            handleUploadUrl: "/api/uploads/order-refs",
            abortSignal: controller.signal,
          });
          uploaded.push({ name: file.name, url: result.url });
        } finally {
          clearTimeout(timer);
        }
      }
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Upload failed",
        description: describeUploadError(err),
      });
    } finally {
      // Keep any files that uploaded before an error, and always stop spinning.
      if (uploaded.length > 0) onChange([...value, ...uploaded]);
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        hidden
        data-testid="input-reference-files"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <Button
        type="button"
        variant="outline"
        disabled={disabled || uploading}
        onClick={() => inputRef.current?.click()}
        data-testid="button-add-references"
        className="rounded-full tracking-widest uppercase text-xs"
      >
        {uploading ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Uploading…
          </>
        ) : (
          <>
            <Upload className="w-4 h-4 mr-2" />
            Add images / video
          </>
        )}
      </Button>

      {value.length > 0 && (
        <ul className="mt-3 space-y-2" data-testid="reference-list">
          {value.map((ref) => (
            <li key={ref.url} className="flex items-center gap-2 text-sm">
              <Paperclip className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <a
                href={ref.url}
                target="_blank"
                rel="noreferrer"
                className="flex-1 truncate underline-offset-2 hover:underline"
              >
                {ref.name}
              </a>
              <button
                type="button"
                onClick={() => onChange(value.filter((r) => r.url !== ref.url))}
                disabled={disabled}
                data-testid="button-remove-reference"
                aria-label={`Remove ${ref.name}`}
                className="text-muted-foreground hover:text-destructive transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
