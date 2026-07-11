// Cosmetic flavor text shown for the active stage on the status timeline.
// This is presentation-only — the authoritative stage list comes live from
// Notion via the API. Stages without an entry fall back to a generic line.

const STAGE_DESCRIPTIONS: Record<string, string> = {
  Consultation:
    "We're still discussing your vision, measurements, and stylistic desires.",
  Sketching:
    "We're translating your ideas into the preliminary designs and technical flats.",
  Sourcing:
    "We're currently curating fabrics, laces, and embellishments from our trusted suppliers.",
  "Pattern Design":
    "Drafting the precise pattern pieces that will shape your garment.",
  "Cutting/Pinning":
    "Cutting fabric to pattern and pinning the foundational silhouette.",
  "Sewing/Construction":
    "We're currently sewing and constructing the garment by hand and machine.",
  Assembly: "We're now assembling all the pieces of your final costume.",
  Fitting: "We're currently in the process of scheduling your fitting(s)!",
  "Rhinestoning/Deatiling":
    "We're now applying hand-beading, crystals, and all the artistic final touches for your costume.",
  "Ready for delivery/pickup":
    "Your garment is complete and awaiting delivery or pickup.",
  Delivery: "Your costume is now delivered!",
};

export function getStageDescription(stage: string): string {
  return (
    STAGE_DESCRIPTIONS[stage] ||
    "Carefully working on this stage of your garment."
  );
}
