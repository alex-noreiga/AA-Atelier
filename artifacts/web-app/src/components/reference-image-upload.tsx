import { useEffect, useRef, useState } from "react";
import {
  FileImage,
  ImagePlus,
  Loader2,
  X,
  AlertCircle,
  Check,
} from "lucide-react";
import {
  ACCEPT_ATTR,
  MAX_REFERENCE_IMAGES,
  uploadReferenceImage,
} from "@/lib/reference-images";

type ItemStatus = "uploading" | "done" | "error";

/** A display-safe version of the user-supplied file name (rendered as plain
 * text). Strips HTML meta-characters and control characters so the untrusted
 * name stays inert wherever it's shown. */
function displayName(name: string): string {
  const cleaned = name.replace(/[<>"'&\u0000-\u001f]/g, "").trim();
  return cleaned.slice(0, 100) || "image";
}

interface ReferenceImageItem {
  key: string;
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
 * shown as a filename row with live per-image status. The parent form receives
 * just the uploaded ids via `onChange` and sends them as the order's
 * `referenceImageIds`; the atelier sees the images themselves on the order's
 * Notion page.
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
      setItems((current) => [
        ...current,
        { key, fileName: displayName(file.name), status: "uploading" },
      ]);
      void startUpload(key, file);
    }
  }

  function removeItem(key: string) {
    setItems((current) => current.filter((item) => item.key !== key));
  }

  const atLimit = items.length >= MAX_REFERENCE_IMAGES;

  return (
    <div>
      {items.length > 0 && (
        <ul className="flex flex-col gap-2 mb-3">
          {items.map((item) => (
            <li
              key={item.key}
              className="flex items-center gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2"
              data-testid="reference-image-item"
            >
              <FileImage className="w-4 h-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-foreground/80">
                  {item.fileName}
                </p>
                {item.status === "error" && (
                  <p className="truncate text-xs text-destructive">
                    {item.error}
                  </p>
                )}
              </div>
              {item.status === "uploading" && (
                <Loader2
                  className="w-4 h-4 shrink-0 animate-spin text-primary"
                  aria-label="Uploading"
                />
              )}
              {item.status === "done" && (
                <Check
                  className="w-4 h-4 shrink-0 text-primary"
                  aria-label="Uploaded"
                />
              )}
              {item.status === "error" && (
                <AlertCircle className="w-4 h-4 shrink-0 text-destructive" />
              )}
              <button
                type="button"
                onClick={() => removeItem(item.key)}
                aria-label={`Remove ${item.fileName}`}
                className="shrink-0 text-muted-foreground hover:text-destructive transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {!atLimit && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
          className="inline-flex items-center gap-2 rounded-full border border-dashed border-border px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid="add-reference-image"
        >
          <ImagePlus className="w-4 h-4" />
          Add images
        </button>
      )}

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
