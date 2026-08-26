// The studio dashboard's sections — the one place that says what the dashboard
// is made of.
//
// The dashboard began as a page of figures and became the atelier's whole
// working surface: materials, the review queue, working hours, appointment
// staffing, settings, the request queue, the newsletter list, the tools, the
// guides. As one scroll that had two costs that only grew. Every panel fetched
// on load, so opening the dashboard to answer one question meant nine
// staff-gated Notion reads — several of them bounded full-database scans —
// before anything was on screen. And every panel added made the page longer,
// so the thing you wanted was further from the top than it was last month.
//
// So the panels are grouped into sections, each with its own address, and only
// the open one is mounted. Three things follow from that, and they are the
// reason this is a registry rather than a hand-written tab bar:
//
//  1. **A view fetches what it shows and nothing else.** Mounting is what
//     starts a query, so a section nobody opened costs nothing. The gate is the
//     exception and is deliberately free — see `lib/studio-access.ts`, which
//     the navbar has already asked and cached by the time this page renders.
//  2. **Adding a panel is an entry here plus a line in the page's view map.**
//     The map is typed `Record<StudioSectionId, …>`, so a section added without
//     a view fails to compile rather than rendering an empty page.
//  3. **A section is a URL, so it survives a reload, a bookmark and the back
//     button.** `/studio` stays the dashboard's address (the navbar link, the
//     post-sign-in hop and the SEO entry all point at it) and is the figures;
//     everything else is `/studio/<id>`.
//
// What goes WITH what is a judgement, and one grouping is load-bearing rather
// than tidy: the request queue and the tools are in the same section because
// the queue hands a request's own order number to the tool that actions it
// (`lib/studio-handoff.ts`). Split across sections, the hand-off would be
// filling a form that isn't mounted.

export interface StudioSectionDef {
  /** The URL segment, and the key of the page's view map. */
  id: string;
  /** How it reads in the section nav. Kept to one word where it can be. */
  label: string;
  /** What the section is for, for the nav's title attribute. */
  summary: string;
}

/** The sections, in the order the nav lists them: what needs doing first. */
export const STUDIO_SECTIONS = [
  {
    id: "figures",
    label: "Figures",
    summary: "Orders, production load, revenue and what's still to collect",
  },
  {
    id: "requests",
    label: "Requests",
    summary: "The customer-request queue, newsletter sign-ups, and the tools",
  },
  {
    id: "shipping",
    label: "Shipping",
    summary: "Buy a label for a shop order and fill in its tracking",
  },
  {
    id: "reviews",
    label: "Reviews",
    summary: "Reviews waiting to be published or set aside",
  },
  {
    id: "bookings",
    label: "Bookings",
    summary: "Working hours, and who offers which appointment",
  },
  {
    id: "materials",
    label: "Materials",
    summary: "What's at or below its reorder point",
  },
  {
    id: "settings",
    label: "Settings",
    summary: "The tunables the atelier can retune without a deploy",
  },
  {
    id: "guides",
    label: "Guides",
    summary: "The studio's own how-to write-ups",
  },
] as const satisfies readonly StudioSectionDef[];

export type StudioSectionId = (typeof STUDIO_SECTIONS)[number]["id"];

/**
 * The section shown at `/studio` itself.
 *
 * Figures, because it is the question the dashboard is opened for most often
 * and because `/studio` is the address every other part of the app already
 * holds — the navbar's staff link, `post-signin.ts`, the SEO entry. Making it
 * redirect to `/studio/figures` would give the dashboard two addresses and gain
 * nothing.
 */
export const DEFAULT_STUDIO_SECTION: StudioSectionId = "figures";

/** The address of one section. The default section is `/studio` itself, so
 * there is exactly one canonical URL per section. */
export function studioSectionPath(id: StudioSectionId): string {
  return id === DEFAULT_STUDIO_SECTION ? "/studio" : `/studio/${id}`;
}

/**
 * Which section a dashboard path is asking for.
 *
 * Fails **open**, to the default: a stale bookmark to a section since renamed,
 * or a typed URL, lands on the figures rather than on a Not Found. The page's
 * 404 is reserved for "you are not staff" — it is what a customer who guessed
 * the URL must see — so spending it on a mistyped section would be both
 * unhelpful to the atelier and a change to what that 404 means.
 */
export function resolveStudioSection(pathname: string): StudioSectionId {
  const segment = pathname.replace(/^\/studio\/?/, "").split("/")[0];
  const match = STUDIO_SECTIONS.find((section) => section.id === segment);
  return match?.id ?? DEFAULT_STUDIO_SECTION;
}
