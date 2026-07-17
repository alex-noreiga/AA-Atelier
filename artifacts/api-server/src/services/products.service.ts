// Shop product use-cases, independent of HTTP. Groups the flat inventory
// variants into cards: rows sharing a `Website Group` become one card with
// selectable variants; ungrouped rows become standalone single-variant cards.

import {
  listCategories,
  listVariants,
} from "../lib/notion/products.repository.js";
import { listSizedCategoryNames } from "../lib/notion/product-categories.repository.js";
import { SIZED_CATEGORY_NAMES } from "../lib/config-audit.js";
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
 *
 * A card's `sized` flag (does its category show the size guide) is looked up from
 * `sizedCategories` by the card's category — the caller passes the live set from
 * the "Product Categories" database, or the built-in fallback.
 */
export function groupVariants(
  variants: VariantRecord[],
  sizedCategories: ReadonlySet<string> = new Set(),
): ProductRecord[] {
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
          sized: sizedCategories.has(variant.category),
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
        sized: sizedCategories.has(variant.category),
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
  const [variants, categories, sizedNames] = await Promise.all([
    listVariants(),
    listCategories(),
    listSizedCategoryNames(),
  ]);
  // `sizedNames === null` means the "Product Categories" database isn't
  // configured yet — fall back to the built-in list so behaviour is unchanged
  // until the atelier populates and enables the Notion source.
  const sizedCategories = new Set(sizedNames ?? SIZED_CATEGORY_NAMES);
  const products = groupVariants(variants, sizedCategories);

  return { products, categories: visibleCategories(categories, products) };
}
