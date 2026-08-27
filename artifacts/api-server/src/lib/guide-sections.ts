// Where a how-to guide is filed — the vocabulary the atelier's Notion `Section`
// value resolves against, and the ids the dashboard matches its render points
// to.
//
// This is a targeted business rule in code, like `lib/service-catalog.ts` and
// `lib/appointments/catalog.ts`: the sections ARE the dashboard's own tools and
// panels, so they're coupled to what the page renders and can't be read live
// from Notion. But both sides need it — the atelier picks one when filing a
// guide, and the dashboard decides where the guide goes — so it is SERVED with
// the guides rather than duplicated in the frontend. A tool renamed here is a
// tool renamed in the one place that says so.
//
// The seven tool ids are deliberately the SAME strings as `StudioToolName`. A
// guide filed against `invoice-lines` renders inside the "Itemize an invoice"
// card, which is what the roadmap card asked for — a guide next to the tool it
// describes, not in a manual somewhere else on the page.
//
// That sameness is load-bearing and was briefly broken: `studio-tools.tsx`
// renders `<GuidesFor section={spec.tool} />` for EVERY tool, so a tool with no
// entry here has a render point no guide can ever resolve to — the guide is
// still served, but it falls back to `general` and lands in the panel at the
// bottom instead of beside the button it describes. Nothing failed, nothing
// logged; the card was simply always empty. `test/unit/guide-sections.test.ts`
// now drives the contract's own `StudioTool` enum and asserts every tool has a
// section, so adding a tool without one fails CI.

/** One place on the dashboard a guide can attach to. */
export interface GuideSection {
  /** What `StudioGuide.section` carries; a tool's id is its `StudioToolName`. */
  id: string;
  /** How it reads to the atelier — and the other spelling `Section` accepts. */
  label: string;
}

/**
 * Where a guide filed against nothing recognizable ends up.
 *
 * Resolution deliberately FAILS OPEN. A guide is something the atelier sat down
 * and wrote; misfiling it under a section name nobody recognized should cost it
 * its position on the page, not its existence. (Contrast `orderDelivered`,
 * which fails closed — withholding a review invitation is recoverable, whereas
 * a guide that silently isn't there is indistinguishable from one nobody
 * wrote.)
 */
export const GENERAL_GUIDE_SECTION = "general";

/** The sections, in the order the dashboard lays them out. */
export const GUIDE_SECTIONS: readonly GuideSection[] = [
  { id: "figures", label: "Figures" },
  { id: "orders", label: "Order stages" },
  { id: "materials", label: "Materials" },
  { id: "pay", label: "Production pay" },
  { id: "shipping", label: "Shipping labels" },
  { id: "reviews", label: "Reviews" },
  { id: "availability", label: "Working hours" },
  { id: "appointment-staff", label: "Appointment staffing" },
  { id: "settings", label: "Studio settings" },
  { id: "requests", label: "Customer requests" },
  { id: "newsletter", label: "Newsletter sign-ups" },
  { id: "milestones", label: "Reconcile production milestones" },
  { id: "invoice-lines", label: "Itemize an invoice" },
  { id: "quote", label: "Quote a flat price" },
  { id: "status-email", label: "Send a status update" },
  { id: "cancellation-refund", label: "Cancel & refund an order" },
  { id: "return-refund", label: "Refund a return" },
  { id: "restock-alert", label: "Send back-in-stock alerts" },
  { id: GENERAL_GUIDE_SECTION, label: "General" },
];

/**
 * Fold a value to its comparable form: lowercase, with everything that isn't a
 * letter or digit dropped.
 *
 * Matching this loosely is on purpose. The atelier types the `Section` into a
 * Notion select by hand, so "Invoice Lines", "invoice-lines" and
 * "Itemize an invoice" should all reach the same card — an ampersand typed as
 * "and", or a stray trailing space, is not a filing decision.
 */
function fold(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Resolve a row's `Section` to a section id.
 *
 * Accepts either spelling — the id or the label — and falls back to
 * {@link GENERAL_GUIDE_SECTION} for anything blank or unrecognized.
 */
export function resolveGuideSection(value: string | undefined): string {
  const wanted = fold(value ?? "");
  if (!wanted) return GENERAL_GUIDE_SECTION;

  const match = GUIDE_SECTIONS.find(
    (section) => fold(section.id) === wanted || fold(section.label) === wanted,
  );
  return match?.id ?? GENERAL_GUIDE_SECTION;
}
