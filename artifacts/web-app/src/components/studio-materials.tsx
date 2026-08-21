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
//  - **Ranking by what to buy first.** The server sorts by shortfall, so the
//    material furthest under its reorder point is at the top.
//  - **Making the unwatched visible.** Most materials have no reorder point set,
//    so a strict alert list would look reassuringly empty while saying nothing
//    about the other forty. Those are listed separately, collapsed.
//  - **Saying when it isn't wired up.** An unconfigured database renders the
//    reason, never an empty list that reads as "all good".

import {
  useGetStudioMaterials,
  getGetStudioMaterialsQueryKey,
  type MaterialAlert,
  type UntrackedMaterial,
} from "@workspace/api-client-react";
import { serverErrorMessage } from "@/lib/api-error";
import { ExternalLink, Loader2, PackageSearch } from "lucide-react";

export function StudioMaterials() {
  const materials = useGetStudioMaterials({
    query: { queryKey: getGetStudioMaterialsQueryKey(), retry: false },
  });

  const data = materials.data;
  const lowStock = data?.lowStock ?? [];
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
      ) : (
        <div className="space-y-3">
          {lowStock.length === 0 && (
            <p
              className="text-sm text-muted-foreground font-light"
              data-testid="materials-empty"
            >
              Nothing is at its reorder point. Every material with one set has
              stock above it.
            </p>
          )}

          {lowStock.map((material) => (
            <MaterialRow key={material.id} material={material} />
          ))}

          {untracked.length > 0 && (
            <details className="pt-2" data-testid="materials-untracked">
              <summary className="cursor-pointer text-xs tracking-[0.15em] uppercase text-muted-foreground/80">
                No reorder point set ({untracked.length})
              </summary>
              <div className="mt-3 space-y-2">
                {untracked.map((material) => (
                  <UntrackedRow key={material.id} material={material} />
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {data?.configured && data.suppressedCount > 0 && (
        <p className="mt-2 text-xs text-muted-foreground/80 font-light">
          {data.suppressedCount} muted.
        </p>
      )}
    </section>
  );
}

/** One material to reorder. */
function MaterialRow({ material }: { material: MaterialAlert }) {
  return (
    <div
      className="rounded-sm border border-border bg-card/40 p-4 flex items-baseline justify-between gap-4"
      data-testid="material-row"
    >
      <div className="min-w-0">
        <p className="text-sm font-light truncate">{material.name}</p>
        <p className="text-xs text-muted-foreground font-light mt-1">
          {material.stockOnHand} left · reorder at {material.minimumStock}
          {material.category ? ` · ${material.category}` : ""}
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
      className="flex items-baseline justify-between gap-4 text-sm font-light"
      data-testid="material-untracked-row"
    >
      <span className="truncate">{material.name}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{why}</span>
    </div>
  );
}
