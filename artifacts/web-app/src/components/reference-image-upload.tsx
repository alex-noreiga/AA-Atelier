import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, X, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ACCEPT_ATTR,
  MAX_REFERENCE_IMAGES,
  uploadReferenceImage,
} from "@/lib/reference-images";

type ItemStatus = "uploading" | "done" | "error";

/** A display-safe version of the user-supplied file name, used only for `alt`
 * text and the remove button's label. Strips HTML meta-characters and control
 * characters so the untrusted name can't be reinterpreted as markup (React
 * already escapes, but this keeps the value clean at the source too). */
function displayName(name: string): string {
  const cleaned = name.replace(/[<>"'&\u0000-\u001f]/g, "").trim();
  return cleaned.slice(0, 100) || "image";
}

interface ReferenceImageItem {
  key: string;
  previewUrl: string;
  fileName: string;
  status: ItemStatus;
  /** The Notion file_upload id, once the upload succeeds. */
  id?: string;
  error?: string;
}

interface ReferenceImageUploadProps {
  /** Called with the successfully-uploaded file_upload ids whenever they change. */
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}

/**
 * Optional reference / inspiration image picker for the order form. Each chosen
 * image is downscaled and uploaded immediately (see `lib/reference-images.ts`),
 * showing a live thumbnail with per-image progress and errors. The parent form
 * receives just the uploaded ids via `onChange` and sends them as the order's
 * `referenceImageIds`.
 */
export function ReferenceImageUpload({
  onChange,
  disabled,
}: ReferenceImageUploadProps) {
  const [items, setItems] = useState<ReferenceImageItem[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const keyCounter = useRef(0);

  // Keep the latest onChange without making it an effect dependency (so the
  // effect fires on id changes, not on every parent re-render).
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const doneIds = items
    .filter((item) => item.status === "done" && item.id)
    .map((item) => item.id as string);
  const idsKey = doneIds.join(",");
  useEffect(() => {
    onChangeRef.current(idsKey ? idsKey.split(",") : []);
  }, [idsKey]);

  // Revoke object URLs on unmount to avoid leaks.
  useEffect(() => {
    return () => {
      setItems((current) => {
        current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
        return current;
      });
    };
  }, []);

  function patchItem(key: string, patch: Partial<ReferenceImageItem>) {
    setItems((current) =>
      current.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    );
  }

  async function startUpload(key: string, file: File) {
    try {
      const { id } = await uploadReferenceImage(file);
      patchItem(key, { status: "done", id });
    } catch (err) {
      patchItem(key, {
        status: "error",
        error: err instanceof Error ? err.message : "Upload failed.",
      });
    }
  }

  function addFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const remaining = MAX_REFERENCE_IMAGES - items.length;
    const files = Array.from(fileList).slice(0, Math.max(0, remaining));

    for (const file of files) {
      const key = `ref-${keyCounter.current++}`;
      const previewUrl = URL.createObjectURL(file);
      setItems((current) => [
        ...current,
        {
          key,
          previewUrl,
          fileName: displayName(file.name),
          status: "uploading",
        },
      ]);
      void startUpload(key, file);
    }
  }

  function removeItem(key: string) {
    setItems((current) => {
      const target = current.find((item) => item.key === key);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((item) => item.key !== key);
    });
  }

  const atLimit = items.length >= MAX_REFERENCE_IMAGES;

  return (
    <div>
      <div className="flex flex-wrap gap-3">
        {items.map((item) => (
          <div
            key={item.key}
            className="relative w-24 h-24 rounded-lg overflow-hidden border border-border bg-muted/20 group"
            data-testid="reference-image-item"
          >
            <img
              src={item.previewUrl}
              alt={item.fileName}
              className={cn(
                "w-full h-full object-cover",
                item.status !== "done" && "opacity-60",
              )}
            />
            {item.status === "uploading" && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/40">
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
              </div>
            )}
            {item.status === "error" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/70 px-1 text-center">
                <AlertCircle className="w-4 h-4 text-destructive mb-0.5" />
                <span className="text-[10px] leading-tight text-destructive">
                  {item.error}
                </span>
              </div>
            )}
            <button
              type="button"
              onClick={() => removeItem(item.key)}
              aria-label={`Remove ${item.fileName}`}
              className="absolute top-1 right-1 w-5 h-5 rounded-full bg-background/80 border border-border flex items-center justify-center text-muted-foreground hover:text-destructive hover:border-destructive transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}

        {!atLimit && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={disabled}
            className="w-24 h-24 rounded-lg border border-dashed border-border flex flex-col items-center justify-center gap-1 text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="add-reference-image"
          >
            <ImagePlus className="w-5 h-5" />
            <span className="text-[10px] tracking-wide uppercase">Add</span>
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTR}
        multiple
        className="hidden"
        data-testid="reference-image-input"
        onChange={(event) => {
          addFiles(event.target.files);
          // Reset so re-selecting the same file fires change again.
          event.target.value = "";
        }}
      />

      <p className="text-muted-foreground/60 text-xs mt-2">
        Up to {MAX_REFERENCE_IMAGES} images (JPEG, PNG, WEBP, or GIF). Sketches,
        photos, or anything that captures the look you're after.
      </p>
    </div>
  );
}
