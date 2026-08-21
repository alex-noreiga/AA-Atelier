// The studio dashboard's how-to guides.
//
// The atelier's procedures are written as standalone HTML files and attached to
// rows in a Notion database; this renders each one beside the tool or panel it
// describes. Nothing about a guide is stored by the app, so correcting a
// procedure is replacing a file — not a deploy.
//
// TWO RULES, AND THE FIRST IS A SECURITY BOUNDARY:
//
//  1. **The markup is never trusted.** It is a file somebody uploaded, on an
//     origin that holds a signed-in staff session — including, in localStorage,
//     the Supabase access token the whole studio surface is gated on. So a
//     guide is rendered in an `<iframe srcDoc>` with a `sandbox` that grants
//     neither `allow-scripts` nor `allow-same-origin`: nothing in the file can
//     run, and even if it could it would be in an opaque origin with no reach
//     into this page. Do not add either token to that attribute. Rendering the
//     HTML inline (`dangerouslySetInnerHTML`) would hand a `<script>` or an
//     `onerror=` the studio session, which is the exact thing this avoids.
//  1b. **Markup is fetched per guide, on open.** The listing carries no HTML —
//     `enabled: opened` defers the second request — so a dashboard nobody reads
//     a guide on downloads nothing, and one slow file can't stall the page.
//  2. **A guide that isn't there is silent, except where it can be explained.**
//     `GuidesFor` renders nothing at all while loading, on error, or with
//     nothing filed against its section — a tool card should not sprout a
//     skeleton or an empty state because the atelier hasn't written that one
//     yet. The panel at the bottom is where an unconfigured database, a failed
//     read, or a guide whose file can't be rendered is actually said out loud.

import { useState } from "react";
import {
  useGetStudioGuides,
  getGetStudioGuidesQueryKey,
  useGetStudioGuideContent,
  getGetStudioGuideContentQueryKey,
  type StudioGuide,
  type StudioGuideUnavailable,
} from "@workspace/api-client-react";
import { serverErrorMessage } from "@/lib/api-error";
import { BookOpen, ExternalLink, Loader2 } from "lucide-react";

/** Where a guide with no recognizable `Section` ends up. Mirrors the server's
 * `GENERAL_GUIDE_SECTION` — the fallback has to be named on both sides, because
 * this is the one section that renders as a panel of its own. */
const GENERAL_SECTION = "general";

/**
 * What the guides query needs everywhere it's used.
 *
 * Every render point calls this rather than the data being threaded down from
 * the page: TanStack Query dedupes on the key, so eleven mount points are still
 * one request, and a tool card stays a component that knows only its own name.
 */
function useGuides() {
  return useGetStudioGuides({
    query: {
      queryKey: getGetStudioGuidesQueryKey(),
      retry: false,
      // Staff membership and a studio's manual both change about as often as an
      // env var does, so the default "stale immediately, refetch on focus"
      // would re-ask on every tab-back for nothing — and this is the sixth
      // studio call per page load against a shared per-IP limiter.
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  });
}

/**
 * The guides filed against one section, rendered inline wherever that section
 * lives — inside a tool's card, under a panel.
 *
 * Deliberately silent in every state but "there are some": see rule 2 above.
 */
export function GuidesFor({ section }: { section: string }) {
  const guides = useGuides();
  const matching = (guides.data?.guides ?? []).filter(
    (guide) => guide.section === section,
  );

  if (matching.length === 0) return null;

  return (
    <div className="mt-4 space-y-2" data-testid={`guides-for-${section}`}>
      {matching.map((guide) => (
        <GuideDisclosure key={guide.id} guide={guide} />
      ))}
    </div>
  );
}

/**
 * The guides panel: everything filed under `general`, plus the things only this
 * panel can say — that the database isn't connected, that the read failed, or
 * that no guide has been written yet.
 */
export function StudioGuides() {
  const guides = useGuides();
  const data = guides.data;
  const all = data?.guides ?? [];
  const general = all.filter((guide) => guide.section === GENERAL_SECTION);
  const elsewhere = all.length - general.length;

  return (
    <section data-testid="panel-guides">
      <h2 className="flex items-center gap-2 text-xs tracking-[0.2em] uppercase text-muted-foreground mb-4">
        <BookOpen className="w-4 h-4" strokeWidth={1.5} />
        How-to guides
        {all.length > 0 && (
          <span
            className="ml-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] tracking-normal text-primary"
            data-testid="guides-count"
          >
            {all.length}
          </span>
        )}
      </h2>

      {guides.isLoading ? (
        <div className="py-8 flex justify-center" data-testid="guides-loading">
          <Loader2
            className="w-5 h-5 animate-spin text-primary"
            strokeWidth={1}
          />
        </div>
      ) : guides.isError ? (
        <p
          className="text-sm text-muted-foreground font-light"
          data-testid="guides-error"
        >
          {serverErrorMessage(guides.error) ??
            "We couldn't load the guides just now."}
        </p>
      ) : data && !data.configured ? (
        <p
          className="text-sm text-muted-foreground font-light"
          data-testid="guides-unconfigured"
        >
          The guides database isn’t connected yet. Set
          NOTION_STUDIO_GUIDES_DATABASE_ID and share the Notion integration with
          the Studio Guides database.
        </p>
      ) : data?.unreachable ? (
        <p
          className="text-sm text-muted-foreground font-light"
          data-testid="guides-unreachable"
        >
          Notion can’t find the Studio Guides database, so no guides can be
          shown. Open it in Notion and share it with the integration (⋯ →
          Connections), and check NOTION_STUDIO_GUIDES_DATABASE_ID holds that
          database’s id.
        </p>
      ) : (
        <div className="space-y-3">
          {all.length === 0 && (
            <p
              className="text-sm text-muted-foreground font-light"
              data-testid="guides-empty"
            >
              No guides yet. Add a row to the Studio Guides database in Notion,
              attach the write-up as an HTML file, and it appears here.
            </p>
          )}

          {general.map((guide) => (
            <GuideDisclosure key={guide.id} guide={guide} />
          ))}

          {/* Guides filed against a tool or panel are rendered there, not here.
              Saying so is what stops this panel reading as the whole manual
              when most of it is further up the page. */}
          {elsewhere > 0 && (
            <p
              className="text-xs text-muted-foreground/80 font-light"
              data-testid="guides-elsewhere"
            >
              {elsewhere} other {elsewhere === 1 ? "guide is" : "guides are"}{" "}
              shown beside the tool or panel it covers.
            </p>
          )}

          {data?.truncated && (
            <p
              className="text-xs text-muted-foreground/80 font-light"
              data-testid="guides-truncated"
            >
              There are more guides than this list shows.
            </p>
          )}

          {data && data.sections.length > 0 && (
            <details className="pt-2" data-testid="guides-sections">
              <summary className="cursor-pointer text-xs tracking-[0.15em] uppercase text-muted-foreground/80">
                Where a guide can go
              </summary>
              <p className="mt-3 text-sm text-muted-foreground font-light">
                Set a row’s <span className="font-normal">Section</span> to one
                of these and the guide is shown there:{" "}
                {data.sections.map((s) => s.label).join(", ")}. Anything else
                shows here under How-to guides.
              </p>
            </details>
          )}
        </div>
      )}
    </section>
  );
}

/** Why a guide has no markup, in the atelier's terms. */
function unavailableReason(
  reason: StudioGuideUnavailable | undefined,
  fileName: string | undefined,
): string {
  switch (reason) {
    case "no-file":
      return "No file attached yet.";
    case "not-uploaded":
      return "That’s a pasted link rather than an uploaded file. Upload the HTML file to this row instead.";
    case "not-html":
      return `${fileName ?? "The attached file"} isn’t an HTML file, so it can’t be shown here.`;
    case "too-large":
      return "The file is too large to show here.";
    default:
      return "The file couldn’t be read just now.";
  }
}

/**
 * One guide, collapsed until asked for — and downloaded only then.
 *
 * The markup is a second request rather than part of the listing, so a
 * dashboard carrying a dozen guides fetches nothing until someone opens one.
 * `enabled: opened` is what defers it; the query cache then holds it, so
 * collapsing and re-opening doesn't re-download.
 */
function GuideDisclosure({ guide }: { guide: StudioGuide }) {
  const [opened, setOpened] = useState(false);

  // The listing already knows the reasons visible without a download, so a
  // guide that can't be rendered is never requested at all.
  const renderable = !guide.unavailable;

  const content = useGetStudioGuideContent(guide.id, {
    query: {
      queryKey: getGetStudioGuideContentQueryKey(guide.id),
      enabled: opened && renderable,
      retry: false,
      staleTime: Infinity,
    },
  });

  const reason = guide.unavailable ?? content.data?.unavailable;
  const html = content.data?.html;

  return (
    <details
      className="rounded-sm border border-border bg-card/40"
      data-testid="guide"
      onToggle={(event) => {
        if ((event.currentTarget as HTMLDetailsElement).open) setOpened(true);
      }}
    >
      <summary className="cursor-pointer list-none p-3 sm:p-4 flex items-baseline justify-between gap-3">
        <span className="min-w-0">
          <span className="block text-sm font-light">{guide.title}</span>
          {guide.summary && (
            <span className="mt-1 block text-xs text-muted-foreground font-light">
              {guide.summary}
            </span>
          )}
        </span>
        <span className="shrink-0 text-[10px] tracking-[0.15em] uppercase text-muted-foreground">
          {renderable ? "Read" : "Unavailable"}
        </span>
      </summary>

      <div className="px-3 pb-3 sm:px-4 sm:pb-4">
        {opened && renderable && content.isLoading ? (
          <div
            className="py-8 flex justify-center"
            data-testid="guide-content-loading"
          >
            <Loader2
              className="w-5 h-5 animate-spin text-primary"
              strokeWidth={1}
            />
          </div>
        ) : opened && renderable && content.isError ? (
          <p
            className="text-xs text-muted-foreground font-light"
            data-testid="guide-unavailable"
          >
            {serverErrorMessage(content.error) ??
              "The guide couldn’t be loaded just now."}
          </p>
        ) : html ? (
          /* The sandbox is the security boundary — see rule 1 at the top of
             this file. `allow-popups` (with the escape) is granted so a link
             in a guide opens in an ordinary new tab; scripts and same-origin
             access are not, and must not be. */
          <iframe
            title={guide.title}
            srcDoc={html}
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            referrerPolicy="no-referrer"
            className="w-full h-[60vh] min-h-72 rounded-sm border border-border bg-white"
            data-testid="guide-frame"
          />
        ) : reason ? (
          <p
            className="text-xs text-muted-foreground font-light"
            data-testid="guide-unavailable"
          >
            {unavailableReason(reason, guide.fileName)}
          </p>
        ) : null}

        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-[10px] text-muted-foreground/80">
            {guide.updatedAt ? `Updated ${formatUpdated(guide.updatedAt)}` : ""}
          </span>
          {guide.notionUrl && (
            <a
              href={guide.notionUrl}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              Edit in Notion
              <ExternalLink className="w-3 h-3" strokeWidth={1.5} />
            </a>
          )}
        </div>
      </div>
    </details>
  );
}

/** A date the atelier reads, degrading to the raw value rather than "Invalid
 * Date" if the contract ever hands over something unexpected. */
function formatUpdated(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
}
