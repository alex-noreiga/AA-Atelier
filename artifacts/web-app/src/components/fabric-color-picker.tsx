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

/** A single selectable swatch tile — a color fill for solids, an image tile for
 * the other types, with the swatch name beneath. Shared by both groupings. */
function SwatchButton({
  fabric,
  selected,
  disabled,
  placement,
  onSelect,
}: {
  fabric: Fabric;
  selected: boolean;
  disabled?: boolean;
  placement: "bodice" | "skirt";
  onSelect: (fabric: Fabric) => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSelect(fabric)}
      aria-pressed={selected}
      title={fabric.name}
      className={cn(
        "flex w-20 flex-col items-center gap-1.5 rounded-lg border p-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
        selected
          ? "border-primary bg-primary/10 text-primary"
          : "border-border/60 text-muted-foreground hover:border-primary/50",
      )}
      data-testid={`fabric-${placement}-${slug(fabric.name)}`}
    >
      {fabric.type === "solid" ? (
        <span
          className="block h-14 w-full rounded-md border border-border/40"
          style={fabric.hex ? { backgroundColor: fabric.hex } : undefined}
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
  const [groupBy, setGroupBy] = useState<"type" | "color">("type");

  const forSection = fabrics.filter(
    (fabric) => fabric.placement === placement || fabric.placement === "both",
  );

  // The color-family groups, in first-appearance order over the (already
  // Sort-ordered) swatch list — so the atelier controls family order via the same
  // Sort numbers. `hasFamilies` gates the toggle; swatches without a family fall
  // into a trailing "Other" group. No family list is hardcoded.
  const families: string[] = [];
  for (const fabric of forSection) {
    if (fabric.colorFamily && !families.includes(fabric.colorFamily)) {
      families.push(fabric.colorFamily);
    }
  }
  const hasFamilies = families.length > 0;
  const hasUnassigned = forSection.some((fabric) => !fabric.colorFamily);
  // Fall back to type grouping whenever no swatch carries a family (the toggle is
  // hidden then), so an all-unassigned palette never shows only "Other".
  const grouping = hasFamilies ? groupBy : "type";

  /** One labelled group of swatches (heading + grid), shared by both groupings. */
  function swatchGroup(key: string, label: string, swatches: Fabric[]) {
    if (swatches.length === 0) return null;
    return (
      <div key={key}>
        <p className="text-xs uppercase tracking-widest text-muted-foreground/80 mb-2">
          {label}
        </p>
        <div
          className="flex flex-wrap gap-3"
          role="group"
          aria-label={`${label} — ${placement}`}
        >
          {swatches.map((fabric) => (
            <SwatchButton
              key={fabric.id}
              fabric={fabric}
              selected={value.fabricId === fabric.id}
              disabled={disabled}
              placement={placement}
              onSelect={selectSwatch}
            />
          ))}
        </div>
      </div>
    );
  }

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
      {/* Group-by toggle — only when swatches carry a color family. */}
      {hasFamilies && (
        <div className="flex gap-2" role="group" aria-label="Group swatches by">
          {(
            [
              { key: "type", label: "By fabric type" },
              { key: "color", label: "By color family" },
            ] as const
          ).map(({ key, label }) => (
            <button
              key={key}
              type="button"
              disabled={disabled}
              onClick={() => setGroupBy(key)}
              aria-pressed={grouping === key}
              className={cn(
                "rounded-full border px-3 py-1 text-xs tracking-wide transition-colors disabled:opacity-50",
                grouping === key
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border/60 text-muted-foreground hover:border-primary/50",
              )}
              data-testid={`fabric-${placement}-groupby-${key}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {grouping === "color"
        ? [
            ...families.map((family) =>
              swatchGroup(
                `family-${family}`,
                family,
                forSection.filter((fabric) => fabric.colorFamily === family),
              ),
            ),
            hasUnassigned
              ? swatchGroup(
                  "family-other",
                  "Other",
                  forSection.filter((fabric) => !fabric.colorFamily),
                )
              : null,
          ]
        : TYPE_GROUPS.map(({ type, label }) =>
            swatchGroup(
              type,
              label,
              forSection.filter((fabric) => fabric.type === type),
            ),
          )}

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
