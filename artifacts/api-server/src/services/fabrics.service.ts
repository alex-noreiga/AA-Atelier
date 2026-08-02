// Fabric-swatch use-case, independent of HTTP. Reads the atelier's fabric palette
// and returns it as a flat list for the order form's visual fabric selector; the
// client groups by type and filters by placement per picker.

import { listFabricRecords } from "../lib/notion/fabrics.repository.js";
import type { FabricRecord } from "../lib/notion/fabrics.schema.js";

/** One swatch as exposed to the client — the contract `Fabric` shape. `sort` is
 * omitted (rather than null) when unset, matching the optional contract field. */
export interface FabricView {
  id: string;
  name: string;
  type: FabricRecord["type"];
  placement: FabricRecord["placement"];
  hex?: string;
  swatchImage?: string;
  colorFamily?: string;
  sort?: number;
}

/**
 * Map + order the swatch records for the client. Sorted by `sort` ascending
 * (unset last), then by name, so the picker's groups render in the atelier's
 * arranged order. Pure (no I/O), so it's unit-testable directly.
 */
export function toFabricList(records: FabricRecord[]): {
  fabrics: FabricView[];
} {
  const fabrics = [...records]
    .sort(
      (a, b) =>
        (a.sort ?? Infinity) - (b.sort ?? Infinity) ||
        a.name.localeCompare(b.name),
    )
    .map(({ sort, ...rest }) => ({
      ...rest,
      ...(sort !== null ? { sort } : {}),
    }));
  return { fabrics };
}

export async function getFabrics(): Promise<{ fabrics: FabricView[] }> {
  const records = await listFabricRecords();
  return toFabricList(records);
}
