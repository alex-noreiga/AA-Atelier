// Grouping the materials panel: by category, and fabric by fabric type.
//
// The reorder list is a shopping list, and a flat one ranked purely by shortfall
// reads as a jumble — a satin, then a box of garment bags, then a power mesh,
// then more boxes. The atelier doesn't shop that way: fabric is one supplier and
// one errand, packaging is another. Their own Notion database already says so
// (a `Category` select, and a saved view grouping fabric by `Fabric Type`), so
// this groups the panel the same way.
//
// Four decisions, and the first two are the ones that matter:
//
//  1. **Groups are ordered by what is most urgent inside them, not by a
//     hardcoded category list.** The panel's whole premise is "buy this first",
//     so the category holding the worst shortfall leads. That also honours the
//     repo's standing rule against baking in a Notion option list: the atelier
//     can add a category and it slots in on its own merit rather than falling
//     off the end of an ordering nobody remembered to update.
//  2. **A material appears ONCE.** `Fabric Type` is a multi-select, so a power
//     mesh that is also a lining carries two — and Notion's own grouped view
//     would show that row twice. On a shopping list that is a way to buy the
//     same fabric twice, so it is filed under the FIRST type and the others are
//     simply not shown: the row is already under a heading that names what it
//     is, and a trailing "also Lining" is noise on a list you are shopping
//     from. The full tagging is in Notion, where it is set.
//  3. **Sub-grouping is driven by the data, not by the word "Fabric".** Any
//     group whose rows carry types gets sub-grouped. Nothing here knows that
//     fabric is the category that does — which is what keeps this working if
//     the atelier ever tags something else the same way.
//  4. **Order WITHIN a group is whatever the server sent.** It already sorted:
//     worst shortfall first for the reorder list, alphabetical for the
//     unwatched one. Re-sorting here would be a second opinion about the same
//     question.

/** What a row needs to be groupable. Both `MaterialAlert` and
 * `UntrackedMaterial` satisfy it, which is why this is structural. */
export interface Groupable {
  category?: string;
  fabricTypes?: string[];
}

/** The heading a material with no `Category` is filed under. */
export const UNCATEGORIZED_LABEL = "Uncategorized";

/** The sub-heading a fabric with no `Fabric Type` is filed under. */
export const UNTYPED_LABEL = "Unspecified";

export interface MaterialSubGroup<T> {
  label: string;
  items: T[];
}

export interface MaterialGroup<T> {
  label: string;
  items: T[];
  /** Only present when this group's rows carry fabric types. Every item in
   * `items` appears in exactly one sub-group. */
  subGroups?: Array<MaterialSubGroup<T>>;
}

/**
 * Order two headings: most urgent first when a rank is supplied, otherwise
 * alphabetically. The catch-all heading is always last however it is ranked —
 * "we don't know what this is" is not something to lead a shopping list with,
 * even when it holds the worst shortfall.
 */
function compareGroups(
  a: { label: string; rank: number },
  b: { label: string; rank: number },
  catchAll: string,
): number {
  if (a.label === catchAll) return b.label === catchAll ? 0 : 1;
  if (b.label === catchAll) return -1;
  return b.rank - a.rank || a.label.localeCompare(b.label);
}

/** Bucket items by a key, preserving both the arrival order of the items and
 * the order the keys were first seen. */
function bucket<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const existing = buckets.get(key);
    if (existing) existing.push(item);
    else buckets.set(key, [item]);
  }
  return buckets;
}

/**
 * Group materials by category, sub-grouping by fabric type wherever the rows
 * carry one.
 *
 * `rank` is what "most urgent" means for these rows — the shortfall, for the
 * reorder list. A group ranks as its highest-ranked member. Omit it and
 * everything is alphabetical, which is what the unwatched list wants.
 */
export function groupMaterials<T extends Groupable>(
  items: T[],
  rank?: (item: T) => number,
): Array<MaterialGroup<T>> {
  const rankOf = (item: T) => rank?.(item) ?? 0;
  const highest = (group: T[]) => Math.max(...group.map(rankOf));

  const byCategory = bucket(
    items,
    (item) => item.category || UNCATEGORIZED_LABEL,
  );

  return [...byCategory]
    .map(([label, groupItems]) => ({
      label,
      rank: highest(groupItems),
      items: groupItems,
      ...(groupItems.some((item) => item.fabricTypes?.length)
        ? { subGroups: subGroup(groupItems, highest) }
        : {}),
    }))
    .sort((a, b) => compareGroups(a, b, UNCATEGORIZED_LABEL))
    .map(({ label, items: groupItems, subGroups }) => ({
      label,
      items: groupItems,
      ...(subGroups ? { subGroups } : {}),
    }));
}

/** Split one category's rows by their FIRST fabric type — see decision 2. */
function subGroup<T extends Groupable>(
  items: T[],
  highest: (group: T[]) => number,
): Array<MaterialSubGroup<T>> {
  const byType = bucket(
    items,
    (item) => item.fabricTypes?.[0] || UNTYPED_LABEL,
  );

  return [...byType]
    .map(([label, typeItems]) => ({
      label,
      rank: highest(typeItems),
      items: typeItems,
    }))
    .sort((a, b) => compareGroups(a, b, UNTYPED_LABEL))
    .map(({ label, items: typeItems }) => ({ label, items: typeItems }));
}
