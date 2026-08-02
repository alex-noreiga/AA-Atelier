import { useState } from "react";
import { Check } from "lucide-react";
import type { Fabric } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";

/** A color name becomes a stable testid slug ("Rose Gold" → "rose-gold"). */
function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** A small color dot for a palette entry — a hex fill for a color, a tiny swatch
 * thumbnail for an image-based fabric, or a muted dot as a fallback. */
function ColorDot({ fabric }: { fabric: Fabric }) {
  const [errored, setErrored] = useState(false);
  if (fabric.hex) {
    return (
      <span
        className="h-4 w-4 shrink-0 rounded-full border border-border/40"
        style={{ backgroundColor: fabric.hex }}
        aria-hidden="true"
      />
    );
  }
  if (fabric.swatchImage && !errored) {
    return (
      <img
        src={fabric.swatchImage}
        alt=""
        onError={() => setErrored(true)}
        className="h-4 w-4 shrink-0 rounded-full border border-border/40 object-cover"
      />
    );
  }
  return (
    <span
      className="h-4 w-4 shrink-0 rounded-full border border-border/40 bg-muted"
      aria-hidden="true"
    />
  );
}

interface ColorPickerProps {
  /** The studio palette (from `useGetFabrics`); each entry is one selectable
   * color chip. Empty when the palette isn't configured — the customer then just
   * describes what they want in the usage note the form renders below. */
  palette: Fabric[];
  /** The currently chosen color names (multi-select), controlled by the form. */
  value: string[];
  onChange: (colors: string[]) => void;
  disabled?: boolean;
}

/**
 * A flat, multi-select palette of color chips for the order form. The customer
 * picks any number of colors they're picturing; the exact fabric + finish is
 * settled later at the consultation, so this captures intent, not a spec. The
 * accompanying "how would you like them used?" note lives in the form beside it.
 */
export function ColorPicker({
  palette,
  value,
  onChange,
  disabled,
}: ColorPickerProps) {
  function toggle(name: string) {
    onChange(
      value.includes(name) ? value.filter((c) => c !== name) : [...value, name],
    );
  }

  if (palette.length === 0) return null;

  return (
    <div
      className="flex flex-wrap gap-2"
      role="group"
      aria-label="Choose colors"
      data-testid="color-picker"
    >
      {palette.map((fabric) => {
        const selected = value.includes(fabric.name);
        return (
          <button
            key={fabric.id}
            type="button"
            disabled={disabled}
            onClick={() => toggle(fabric.name)}
            aria-pressed={selected}
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
              selected
                ? "border-primary bg-primary/10 text-primary"
                : "border-border/60 text-muted-foreground hover:border-primary/50",
            )}
            data-testid={`color-${slug(fabric.name)}`}
          >
            <ColorDot fabric={fabric} />
            {fabric.name}
            {selected && <Check className="w-3 h-3 shrink-0" />}
          </button>
        );
      })}
    </div>
  );
}
