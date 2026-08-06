import { Check } from "lucide-react";
import type { Color } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";

/** A color name becomes a stable testid slug ("Rose Gold" → "rose-gold"). */
function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** A small hex-fill dot for a palette entry. */
function ColorDot({ color }: { color: Color }) {
  return (
    <span
      className="h-4 w-4 shrink-0 rounded-full border border-border/40"
      style={{ backgroundColor: color.hex }}
      aria-hidden="true"
    />
  );
}

interface ColorPickerProps {
  /** The studio palette (from `useGetColors`); each entry is one selectable
   * color chip. Always non-empty (the API falls back to a built-in primary
   * palette), so the customer picks from it and refines in the usage note. */
  palette: Color[];
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
      {palette.map((color) => {
        const selected = value.includes(color.name);
        return (
          <button
            key={color.id}
            type="button"
            disabled={disabled}
            onClick={() => toggle(color.name)}
            aria-pressed={selected}
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
              selected
                ? "border-primary bg-primary/10 text-primary"
                : "border-border/60 text-muted-foreground hover:border-primary/50",
            )}
            data-testid={`color-${slug(color.name)}`}
          >
            <ColorDot color={color} />
            {color.name}
            {selected && <Check className="w-3 h-3 shrink-0" />}
          </button>
        );
      })}
    </div>
  );
}
