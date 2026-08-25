// The studio dashboard's materials restock alerts.
//
// The atelier's materials inventory has carried a reorder point, a stock-on-hand
// formula and a restock-alert formula per material since long before the app
// existed — and nothing ever read them, so the alerts only existed for someone
// who thought to open that Notion database mid-project. This is that list, next
// to everything else the studio runs from here.
//
// What the panel is responsible for, beyond listing rows:
//
//  - **Grouping the way the atelier shops.** By category, and fabric by fabric
//    type — because fabric is one supplier and one errand, packaging is
//    another, and a flat list ranked purely by shortfall interleaves them. The
//    rules live in `lib/material-groups.ts`; the one worth knowing here is that
//    a material appears exactly ONCE even when it carries several fabric types.
//  - **Ranking by what to buy first, within each group.** The server sorts by
//    shortfall, and the group holding the worst shortfall leads — so the top of
//    the panel is still the thing to buy first.
//  - **Only listing what can actually be bought.** A deadstock lot or a
//    discontinued line has no vendor to send anyone to, so the server keeps it
//    out of the reorder list. It is NOT dropped: running a one-of-a-kind fabric
//    down is exactly when a substitute has to be chosen, so it gets its own
//    section saying which it is.
//  - **Making the unwatched visible.** Most materials have no reorder point set,
//    so a strict alert list would look reassuringly empty while saying nothing
//    about the other forty. Those are listed separately, collapsed.
//  - **Saying when it isn't wired up.** An unconfigured database renders the
//    reason, never an empty list that reads as "all good". A database the
//    integration can't see (`unreachable`) reads the same way, with the fix for
//    that state instead — it used to be the one configuration mistake here that
//    surfaced as a failed panel.

import {
  useGetStudioMaterials,
  getGetStudioMaterialsQueryKey,
  type MaterialAlert,
  type UntrackedMaterial,
} from "@workspace/api-client-react";
import { serverErrorMessage } from "@/lib/api-error";
import {
  groupMaterials,
  secondaryFabricTypes,
  type MaterialGroup,
} from "@/lib/material-groups";
import { ExternalLink, Loader2, PackageSearch } from "lucide-react";

export function StudioMaterials() {
  const materials = useGetStudioMaterials({
    query: { queryKey: getGetStudioMaterialsQueryKey(), retry: false },
  });

  const data = materials.data;
  const lowStock = data?.lowStock ?? [];
  const notRestockable = data?.notRestockable ?? [];
  const untracked = data?.untracked ?? [];

  return (
    <section data-testid="panel-materials">
      <h2 className="flex items-center gap-2 text-xs tracking-[0.2em] uppercase text-muted-foreground mb-4">
        <PackageSearch className="w-4 h-4" strokeWidth={1.5} />
        Materials
        {lowStock.length > 0 && (
          <span
            className="ml-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] tracking-normal text-primary"
            data-testid="materials-low-count"
          >
            {lowStock.length} to reorder
          </span>
        )}
      </h2>

      {materials.isLoading ? (
        <div
          className="py-8 flex justify-center"
          data-testid="materials-loading"
        >
          <Loader2
            className="w-5 h-5 animate-spin text-primary"
            strokeWidth={1}
          />
        </div>
      ) : materials.isError ? (
        <p
          className="text-sm text-muted-foreground font-light"
          data-testid="materials-error"
        >
          {serverErrorMessage(materials.error) ??
            "We couldn't load the materials just now."}
        </p>
      ) : data && !data.configured ? (
        <p
          className="text-sm text-muted-foreground font-light"
          data-testid="materials-unconfigured"
        >
          The materials database isn’t connected yet, so nothing can be checked.
          Set NOTION_MATERIALS_DATABASE_ID and share the Notion integration with
          the materials inventory.
        </p>
      ) : data?.unreachable ? (
        <p
          className="text-sm text-muted-foreground font-light"
          data-testid="materials-unreachable"
        >
          Notion can’t find the materials database, so nothing can be checked.
          Open the materials inventory in Notion and share it with the
          integration (⋯ → Connections), and check NOTION_MATERIALS_DATABASE_ID
          holds that database’s id.
        </p>
      ) : (
        <div className="space-y-5">
          {lowStock.length === 0 && (
            <p
              className="text-sm text-muted-foreground font-light"
              data-testid="materials-empty"
            >
              Nothing is at its reorder point. Every material with one set has
              stock above it.
            </p>
          )}

          {groupMaterials(lowStock, (material) => material.shortfall).map(
            (group) => (
              <MaterialCategory
                key={group.label}
                group={group}
                render={(material) => (
                  <MaterialRow key={material.id} material={material} />
                )}
              />
            ),
          )}

          {notRestockable.length > 0 && (
            <details className="pt-2" data-testid="materials-not-restockable">
              <summary className="cursor-pointer text-xs tracking-[0.15em] uppercase text-muted-foreground/80">
                Can&apos;t be reordered ({notRestockable.length})
              </summary>
              <p className="mt-2 text-xs text-muted-foreground font-light">
                Low, but marked deadstock or discontinued. Pick a substitute in
                Notion.
              </p>
              <div className="mt-3 space-y-4">
                {groupMaterials(
                  notRestockable,
                  (material) => material.shortfall,
                ).map((group) => (
                  <MaterialCategory
                    key={group.label}
                    group={group}
                    render={(material) => (
                      <MaterialRow key={material.id} material={material} />
                    )}
                  />
                ))}
              </div>
            </details>
          )}

          {untracked.length > 0 && (
            <details className="pt-2" data-testid="materials-untracked">
              <summary className="cursor-pointer text-xs tracking-[0.15em] uppercase text-muted-foreground/80">
                No reorder point set ({untracked.length})
              </summary>
              <div className="mt-3 space-y-4">
                {groupMaterials(untracked).map((group) => (
                  <MaterialCategory
                    key={group.label}
                    group={group}
                    render={(material) => (
                      <UntrackedRow key={material.id} material={material} />
                    )}
                  />
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * One category, with its rows — sub-headed by fabric type where the rows carry
 * one. `render` rather than a shared row component because the two lists show
 * genuinely different things: a card with a reorder link, and a one-line note
 * about why nothing can alert.
 */
function MaterialCategory<T extends { id: string }>({
  group,
  render,
}: {
  group: MaterialGroup<T>;
  render: (item: T) => React.ReactNode;
}) {
  return (
    <section
      className="space-y-2"
      data-testid={`material-category-${group.label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <h3 className="flex items-baseline gap-2 text-xs tracking-[0.15em] uppercase text-muted-foreground/80">
        {group.label}
        <span className="text-[10px] tracking-normal text-muted-foreground/60">
          {group.items.length}
        </span>
      </h3>

      {group.subGroups
        ? group.subGroups.map((sub) => (
            <div
              key={sub.label}
              className="space-y-2 border-l border-border/60 pl-3"
              data-testid={`material-fabric-${sub.label.toLowerCase().replace(/\s+/g, "-")}`}
            >
              <p className="text-[10px] tracking-[0.15em] uppercase text-muted-foreground/60">
                {sub.label}
              </p>
              {sub.items.map(render)}
            </div>
          ))
        : group.items.map(render)}
    </section>
  );
}

/**
 * Is this `Reorder Status` worth saying on the row?
 *
 * `Restockable` is the ordinary case and adds nothing to a list of things to
 * buy; an unset one says nothing at all. Everything else does: `Made to order`
 * is a lead time, `Deadstock` and `Discontinued` are the reason the row is in
 * the section it's in.
 */
function noteworthyStatus(status?: string): boolean {
  return Boolean(status) && status!.trim().toLowerCase() !== "restockable";
}

/** One material to reorder. The category is the heading above it now, so the
 * meta line spends its room on what the heading can't show. */
function MaterialRow({ material }: { material: MaterialAlert }) {
  const alsoTagged = secondaryFabricTypes(material);

  return (
    <div
      className="rounded-sm border border-border bg-card/40 p-3 sm:p-4 flex items-baseline justify-between gap-3 sm:gap-4"
      data-testid="material-row"
    >
      <div className="min-w-0">
        <p className="text-sm font-light truncate">{material.name}</p>
        <p className="text-xs text-muted-foreground font-light mt-1">
          {material.stockOnHand} left · reorder at {material.minimumStock}
          {alsoTagged.length > 0 ? ` · also ${alsoTagged.join(", ")}` : ""}
          {noteworthyStatus(material.reorderStatus)
            ? ` · ${material.reorderStatus}`
            : ""}
        </p>
      </div>
      {material.link && (
        <a
          href={material.link}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          Reorder
          <ExternalLink className="w-3 h-3" strokeWidth={1.5} />
        </a>
      )}
    </div>
  );
}

/** One material nothing can ever alert on, and why. */
function UntrackedRow({ material }: { material: UntrackedMaterial }) {
  const why =
    material.reason === "stock-unknown"
      ? "no stock recorded"
      : material.stockOnHand !== undefined
        ? `${material.stockOnHand} on hand`
        : "no reorder point";

  return (
    <div
      className="flex items-baseline justify-between gap-3 sm:gap-4 text-sm font-light"
      data-testid="material-untracked-row"
    >
      <span className="truncate">{material.name}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{why}</span>
    </div>
  );
}
