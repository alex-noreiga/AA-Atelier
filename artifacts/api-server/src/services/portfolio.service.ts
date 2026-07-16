// Portfolio (gallery) use-cases, independent of HTTP. Flatter than products:
// each Notion row is one gallery item, so there's no variant grouping.

import {
  listCategories,
  listPortfolioItems,
} from "../lib/notion/portfolio.repository.js";
import type { PortfolioItemRecord } from "../lib/notion/portfolio.schema.js";

/**
 * Narrow the live Category options to those that actually have an item in the
 * gallery, preserving Notion's ordering. Pure, so it can be unit-tested. An
 * option defined but not yet used would otherwise render a filter chip that
 * leads to an empty grid.
 */
export function visibleCategories(
  categories: string[],
  items: PortfolioItemRecord[],
): string[] {
  const used = new Set(
    items
      .map((item) => item.category)
      .filter((category): category is string => Boolean(category)),
  );
  return categories.filter((category) => used.has(category));
}

export async function getPortfolio(): Promise<{
  items: PortfolioItemRecord[];
  categories: string[];
}> {
  const [items, categories] = await Promise.all([
    listPortfolioItems(),
    listCategories(),
  ]);

  return { items, categories: visibleCategories(categories, items) };
}
