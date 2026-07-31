import { useState } from "react";
import type { Fabric, FabricSelection } from "@workspace/api-client-react";
import { Textarea } from "@/components/ui/textarea";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import { ReferenceImageUpload } from "@/components/reference-image-upload";
import { cn } from "@/lib/utils";

// The fabric-type groups, in the order they render within a picker, with the
// customer-facing group heading. The keys are the contract `Fabric.type` values;
// the picker never hardcodes the swatch list itself (that's live from Notion),
// only this fixed display order + labels.
const TYPE_GROUPS = [
  { type: "solid", label: "Solid colors" },
  { type: "print", label: "Prints" },
  { type: "foil", label: "Foil" },
  { type: "textured", label: "Textured" },
  { type: "sequin", label: "Sequin" },
] as const;

/** A swatch name becomes a stable testid slug ("Rose Gold" → "rose-gold"). */
function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** An image-backed swatch tile that falls back to a monogram placeholder when the
 * swatch photo is missing or its (short-lived) Notion URL has expired. */
function ImageSwatch({ fabric }: { fabric: Fabric }) {
  const [errored, setErrored] = useState(false);
  const showImage = fabric.swatchImage && !errored;
  return (
    <AspectRatio ratio={1} className="overflow-hidden rounded-md">
      {showImage ? (
        <img
          src={fabric.swatchImage}
          alt={fabric.name}
          className="h-full w-full object-cover"
          onError={() => setErrored(true)}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-card via-background to-primary/20 text-xs tracking-widest text-muted-foreground/70">
          AA
        </div>
      )}
    </AspectRatio>
  );
}

interface FabricColorPickerProps {
  /** Which picker this is — filters the fabric list to swatches whose placement
   * is this section or "both". */
  placement: "bodice" | "skirt";
  /** The full swatch list from `useGetFabrics` (the parent fetches once). */
  fabrics: Fabric[];
  /** The current selection for this section (controlled by the parent form). */
  value: FabricSelection;
  onChange: (value: FabricSelection) => void;
  disabled?: boolean;
}

/**
 * The visual fabric/color selector for one garment section (bodice or skirt).
 * Swatches are grouped by fabric type; selecting one records it on the order.
 * An "I don't see the color I want" escape hatch reveals a free-text field, and
 * a custom-print path reuses the reference-image upload — a swatch selection and
 * a free-text note are mutually exclusive (choosing one clears the other), while
 * a custom print can accompany either.
 *
 * Controlled + form-agnostic: it holds only the local escape-hatch toggle; the
 * selection value lives in the parent form. When no swatches match (the Fabrics
 * database is unconfigured or empty for this section) only the escape hatch and
 * custom-print path show, so the customer can still describe what they want.
 */
export function FabricColorPicker({
  placement,
  fabrics,
  value,
  onChange,
  disabled,
}: FabricColorPickerProps) {
  const [noteOpen, setNoteOpen] = useState(!!value.colorNote);

  const forSection = fabrics.filter(
    (fabric) => fabric.placement === placement || fabric.placement === "both",
  );

  function selectSwatch(fabric: Fabric) {
    const alreadySelected = value.fabricId === fabric.id;
    if (alreadySelected) {
      // Toggle off — clear the swatch choice (custom print/note untouched).
      const { fabricId, fabricName, fabricType, ...rest } = value;
      onChange(rest);
      return;
    }
    // Selecting a swatch clears the free-text color note (mutually exclusive).
    const { colorNote, ...rest } = value;
    onChange({
      ...rest,
      fabricId: fabric.id,
      fabricName: fabric.name,
      fabricType: fabric.type,
    });
    setNoteOpen(false);
  }

  function toggleNote() {
    if (noteOpen) {
      // Closing the escape hatch discards its text.
      const { colorNote, ...rest } = value;
      onChange(rest);
      setNoteOpen(false);
    } else {
      // Opening it clears any chosen swatch (mutually exclusive).
      const { fabricId, fabricName, fabricType, ...rest } = value;
      onChange(rest);
      setNoteOpen(true);
    }
  }

  function setColorNote(colorNote: string) {
    onChange({ ...value, ...(colorNote ? { colorNote } : {}) });
  }

  function setCustomPrintIds(ids: string[]) {
    const { customPrintImageIds, ...rest } = value;
    onChange(ids.length > 0 ? { ...rest, customPrintImageIds: ids } : rest);
  }

  return (
    <div className="space-y-5" data-testid={`fabric-picker-${placement}`}>
      {TYPE_GROUPS.map(({ type, label }) => {
        const swatches = forSection.filter((fabric) => fabric.type === type);
        if (swatches.length === 0) return null;
        return (
          <div key={type}>
            <p className="text-xs uppercase tracking-widest text-muted-foreground/80 mb-2">
              {label}
            </p>
            <div
              className="flex flex-wrap gap-3"
              role="group"
              aria-label={`${label} — ${placement}`}
            >
              {swatches.map((fabric) => {
                const isSelected = value.fabricId === fabric.id;
                return (
                  <button
                    key={fabric.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => selectSwatch(fabric)}
                    aria-pressed={isSelected}
                    title={fabric.name}
                    className={cn(
                      "flex w-20 flex-col items-center gap-1.5 rounded-lg border p-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
                      isSelected
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border/60 text-muted-foreground hover:border-primary/50",
                    )}
                    data-testid={`fabric-${placement}-${slug(fabric.name)}`}
                  >
                    {fabric.type === "solid" ? (
                      <span
                        className="block h-14 w-full rounded-md border border-border/40"
                        style={
                          fabric.hex
                            ? { backgroundColor: fabric.hex }
                            : undefined
                        }
                        aria-hidden="true"
                      />
                    ) : (
                      <span className="block w-full">
                        <ImageSwatch fabric={fabric} />
                      </span>
                    )}
                    <span className="w-full truncate text-center text-[0.7rem] leading-tight">
                      {fabric.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Escape hatch — "I don't see the color I want" reveals a free-text field. */}
      <div>
        <button
          type="button"
          disabled={disabled}
          onClick={toggleNote}
          aria-pressed={noteOpen}
          className={cn(
            "rounded-full border px-4 py-1.5 text-xs uppercase tracking-widest transition-colors disabled:opacity-50",
            noteOpen
              ? "border-primary bg-primary/10 text-primary"
              : "border-dashed border-border text-muted-foreground hover:border-primary/50 hover:text-primary",
          )}
          data-testid={`fabric-${placement}-escape-hatch`}
        >
          I don't see the color I want
        </button>
        {noteOpen && (
          <Textarea
            value={value.colorNote ?? ""}
            onChange={(event) => setColorNote(event.target.value)}
            disabled={disabled}
            placeholder="Describe the color or fabric you're after — a shade, a reference, a swatch you've seen…"
            rows={3}
            className="mt-2 bg-transparent border border-border rounded-lg px-3 py-2 text-sm focus-visible:ring-0 focus-visible:border-primary transition-colors resize-none shadow-none"
            data-testid={`fabric-${placement}-color-note`}
          />
        )}
      </div>

      {/* Custom print — upload your own print artwork. */}
      <div>
        <p className="text-xs uppercase tracking-widest text-muted-foreground/80 mb-2">
          Custom print
        </p>
        <ReferenceImageUpload
          onChange={setCustomPrintIds}
          disabled={disabled}
          label="Upload your print"
          max={3}
          helpText="Have your own print? Upload the artwork (JPEG, PNG, WEBP, or GIF) and we'll work from it."
        />
      </div>
    </div>
  );
}
