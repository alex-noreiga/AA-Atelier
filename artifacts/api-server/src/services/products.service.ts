// Shop product use-cases, independent of HTTP. Groups the flat inventory
// variants into cards: rows sharing a `Website Group` become one card with
// selectable variants; ungrouped rows become standalone single-variant cards.

import { listVariants } from "../lib/notion/products.repository.js";
import { listCategoryRecords } from "../lib/notion/product-categories.repository.js";
import type { CategoryRecord } from "../lib/notion/product-categories.schema.js";
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
  const {
    category: _category,
    categoryId: _categoryId,
    group: _group,
    ...rest
  } = variant;
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

/**
 * Build the shop payload from the Product Categories records (the configured
 * path). Each variant's category + sized flag is resolved from its `Category`
 * relation via the record's page id; a variant with no link falls back to its
 * "Item Type" label. The chip list is the category names ordered by `Sort`,
 * narrowed to those actually stocked. Pure, so it's unit-testable directly.
 */
export function resolveFromCategories(
  variants: VariantRecord[],
  records: CategoryRecord[],
): { products: ProductRecord[]; categories: string[] } {
  const byId = new Map(records.map((record) => [record.id, record]));
  // Resolve the authoritative category name from the relation; keep the Item Type
  // label when a row isn't linked (or its category was deleted).
  const resolved = variants.map((variant) => {
    const record = variant.categoryId
      ? byId.get(variant.categoryId)
      : undefined;
    return record ? { ...variant, category: record.name } : variant;
  });
  const sizedCategories = new Set(
    records.filter((record) => record.sized).map((record) => record.name),
  );
  const products = groupVariants(resolved, sizedCategories);
  const orderedNames = [...records]
    .sort((a, b) => (a.sort ?? Infinity) - (b.sort ?? Infinity))
    .map((record) => record.name);

  return { products, categories: visibleCategories(orderedNames, products) };
}

export async function getProducts(): Promise<{
  products: ProductRecord[];
  categories: string[];
}> {
  const [variants, records] = await Promise.all([
    listVariants(),
    listCategoryRecords(),
  ]);

  // The "Product Categories" database is the shop's sole source for the category
  // list + size-guide flag. `null` means its env var is unset — fail loud rather
  // than silently empty the shop, since there is no longer a fallback source.
  if (!records) {
    throw new Error(
      "NOTION_PRODUCT_CATEGORIES_DATABASE_ID is not configured for the shop category source",
    );
  }

  return resolveFromCategories(variants, records);
}
