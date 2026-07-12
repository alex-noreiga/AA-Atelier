// Shop product use-cases, independent of HTTP. Groups the flat inventory
// variants into cards: rows sharing a `Website Group` become one card with
// selectable variants; ungrouped rows become standalone single-variant cards.

import {
  listCategories,
  listVariants,
} from "../lib/notion/products.repository.js";
import type {
  ProductRecord,
  ProductVariantRecord,
  VariantRecord,
} from "../lib/notion/products.schema.js";

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "group"
  );
}

function toVariantRecord(variant: VariantRecord): ProductVariantRecord {
  const { category: _category, group: _group, ...rest } = variant;
  return rest;
}

/**
 * Group flat inventory variants into shop cards. Pure (no I/O) so it can be
 * unit-tested directly. Rows sharing a `Website Group` merge into one card
 * (first-seen order preserved); ungrouped rows become standalone cards.
 */
export function groupVariants(variants: VariantRecord[]): ProductRecord[] {
  const cards: ProductRecord[] = [];
  // Grouped cards, keyed by the group value; preserves first-seen order.
  const groups = new Map<string, ProductRecord>();

  for (const variant of variants) {
    if (variant.group) {
      let card = groups.get(variant.group);
      if (!card) {
        card = {
          id: `group-${slugify(variant.group)}`,
          title: variant.group,
          category: variant.category,
          variants: [],
        };
        groups.set(variant.group, card);
        cards.push(card);
      }
      card.variants.push(toVariantRecord(variant));
    } else {
      cards.push({
        id: variant.id,
        title: variant.name,
        category: variant.category,
        variants: [toVariantRecord(variant)],
      });
    }
  }

  return cards;
}

/**
 * Narrow the live Item Type options to those that actually have a card on the
 * shop, preserving Notion's ordering. Pure, so it can be unit-tested directly.
 * An option the team has defined but not yet stocked would otherwise render a
 * filter chip that leads to an empty grid.
 */
export function visibleCategories(
  categories: string[],
  products: ProductRecord[],
): string[] {
  const stocked = new Set(products.map((product) => product.category));
  return categories.filter((category) => stocked.has(category));
}

export async function getProducts(): Promise<{
  products: ProductRecord[];
  categories: string[];
}> {
  const [variants, categories] = await Promise.all([
    listVariants(),
    listCategories(),
  ]);
  const products = groupVariants(variants);

  return { products, categories: visibleCategories(categories, products) };
}
