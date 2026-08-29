// Shop-order tracking use-cases, independent of HTTP. Mirrors orders.service's
// getOrderStatus but reads the ready-to-wear "Shop Orders" database and reports
// the Notion fulfilment "Status" workflow rather than the custom-order stages.

import {
  findShopOrderByNumber,
  fetchLiveShopOrderStatuses,
} from "../lib/notion/shop-orders.repository.js";
import { resolveFulfilment, type FulfilmentView } from "../lib/fulfilment.js";
import { appointmentTimezone } from "../lib/appointments/settings.js";
import { orderDelivered } from "./delivery.js";
import { findVariantNames } from "./products.service.js";
import { NotFoundError } from "../lib/errors.js";

export interface ShopOrderStatusView {
  orderNumber: string;
  status: string;
  statuses: string[];
  total?: number;
  cancelled?: boolean;
  /** How the order reaches the customer — carrier tracking, or a scheduled
   * local pickup for a customer collecting in person. */
  fulfilment?: FulfilmentView;
  /** The pieces on the order, so a delivered one can offer a review of a
   * particular piece. Absent when there are none to name. */
  items?: Array<{ id: string; name: string }>;
}

export async function getShopOrderStatus(
  orderNumber: string,
): Promise<ShopOrderStatusView> {
  const [order, statuses] = await Promise.all([
    findShopOrderByNumber(orderNumber),
    fetchLiveShopOrderStatuses(),
  ]);

  if (!order) {
    throw new NotFoundError("We couldn't find a shop order with that number.");
  }

  // The order's current status may not be in the live options list (e.g. a
  // renamed/removed option); ensure the timeline still includes it.
  const timeline =
    order.status && !statuses.includes(order.status)
      ? [...statuses, order.status]
      : statuses;

  // The same fulfilment view the custom orders get, off the same rules: carrier
  // tracking once the parcel is on its way, or the collection details when the
  // customer is picking up in person. Dropped on a cancelled order, where
  // nothing is coming.
  const fulfilment = order.cancelled
    ? undefined
    : resolveFulfilment(order.fulfilmentFields ?? {}, {
        timezone: appointmentTimezone(),
        delivered: orderDelivered(order.status, timeline),
      });

  // The pieces on the order, named. Only worth resolving once the order is
  // finished and not cancelled, which is the one moment the tracking page asks
  // the question ("which piece are you reviewing?") — so an in-progress lookup
  // costs no inventory read. Best-effort by construction: `findVariantNames`
  // swallows its own failures, and a piece it can't name is left out rather than
  // offered as a blank choice.
  const items =
    !order.cancelled &&
    order.itemIds?.length &&
    orderDelivered(order.status, timeline)
      ? await namedItems(order.itemIds)
      : [];

  return {
    orderNumber: order.orderNumber,
    status: order.status,
    statuses: timeline,
    ...(order.total !== undefined ? { total: order.total } : {}),
    ...(order.cancelled ? { cancelled: true } : {}),
    ...(fulfilment ? { fulfilment } : {}),
    ...(items.length > 0 ? { items } : {}),
  };
}

/** Inventory ids paired with their names, in the order's own order, dropping
 * any the shop can't name (an unpublished piece, or a failed inventory read). */
async function namedItems(
  ids: string[],
): Promise<Array<{ id: string; name: string }>> {
  const names = await findVariantNames(ids);
  return ids
    .map((id) => ({ id, name: names.get(id) ?? "" }))
    .filter((item) => item.name !== "");
}
