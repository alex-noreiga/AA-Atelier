// What the studio posts things in — the boxes and mailers the atelier actually
// keeps by the packing bench, as a code catalog.
//
// A TARGETED BUSINESS RULE in code, like `lib/appointments/catalog.ts` and
// `lib/service-catalog.ts`, and for the same reason: both sides need it. The
// dashboard renders these as the choices, and the server rates against the
// dimensions they carry, so a preset the form offers is a preset the rating call
// understands. It is SERVED (on `GET /studio/shipments/options`) rather than
// duplicated in the frontend — a packaging size the form offers that the server
// can't rate would be a dead option nobody could diagnose.
//
// Dimensions are the catalog's; WEIGHT is not. A box's size is a property of the
// box, but what goes in it is a dress one day and a pair of soakers the next, and
// a wrong weight is either a refused parcel or postage the studio silently
// overpays. So the weight is typed per shipment and the presets carry none.
//
// Adding a size is an entry here and a deploy. That is the right friction for a
// list that changes when the studio buys different packaging — perhaps twice a
// year — and it keeps the rating call from ever being handed a shape no rate
// exists for.

/** One packaging option, in inches. */
export interface ParcelPreset {
  /** Stable id — what the dashboard sends back and stored nowhere else. */
  id: string;
  /** How it reads on the packing bench. */
  name: string;
  /** What it is for, so the right one is picked without a tape measure. */
  hint: string;
  length: number;
  width: number;
  height: number;
}

/**
 * The studio's packaging, smallest first — which is also cheapest first, so the
 * option the atelier should reach for is the one they read first.
 */
export const PARCEL_PRESETS: readonly ParcelPreset[] = [
  {
    id: "poly-small",
    name: "Small poly mailer",
    hint: "Soakers, blade towels, a single small accessory",
    length: 10,
    width: 7,
    height: 1,
  },
  {
    id: "poly-large",
    name: "Large poly mailer",
    hint: "A folded practice dress or a soft-goods bundle",
    length: 14,
    width: 11,
    height: 2,
  },
  {
    id: "box-small",
    name: "Small box",
    hint: "One competition dress, boxed flat",
    length: 12,
    width: 9,
    height: 4,
  },
  {
    id: "box-medium",
    name: "Medium box",
    hint: "A dress with a skirt that shouldn't be crushed",
    length: 16,
    width: 12,
    height: 6,
  },
  {
    id: "box-large",
    name: "Large box",
    hint: "Several pieces, or a heavily-stoned costume with padding",
    length: 18,
    width: 14,
    height: 8,
  },
] as const;

/** The preset a dashboard id names, or undefined for one this build doesn't have. */
export function findParcelPreset(id: string): ParcelPreset | undefined {
  const wanted = id.trim();
  return PARCEL_PRESETS.find((preset) => preset.id === wanted);
}

/**
 * The heaviest parcel this flow will rate, in ounces (50 lb).
 *
 * The domestic ceiling for every service the studio would use, and — far more
 * to the point — the value that catches the typo this exists for. A weight is
 * typed by hand into a box next to a "buy" button; entering pounds where ounces
 * were wanted, or a stray digit, is how a 12 oz dress asks to be rated at 192
 * lb. The carrier would refuse it anyway, but refusing here says why.
 */
export const MAX_PARCEL_WEIGHT_OZ = 800;

/**
 * Why this weight can't be posted, or null when it can.
 *
 * Zero is refused rather than treated as unset: a parcel weighs something, and
 * a carrier rating a 0 oz package prices a document envelope. The atelier is
 * told to weigh it rather than being quietly sold the wrong postage.
 */
export function weightProblem(weightOz: number): string | null {
  if (!Number.isFinite(weightOz)) return "Enter the parcel's weight in ounces.";
  if (weightOz <= 0) {
    return "A parcel has to weigh something — put it on the scale and enter the weight in ounces.";
  }
  if (weightOz > MAX_PARCEL_WEIGHT_OZ) {
    return `That's over ${MAX_PARCEL_WEIGHT_OZ} oz (${MAX_PARCEL_WEIGHT_OZ / 16} lb). Check the weight is in ounces, not pounds.`;
  }
  return null;
}
