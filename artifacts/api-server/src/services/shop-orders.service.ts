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

  return {
    orderNumber: order.orderNumber,
    status: order.status,
    statuses: timeline,
    ...(order.total !== undefined ? { total: order.total } : {}),
    ...(order.cancelled ? { cancelled: true } : {}),
    ...(fulfilment ? { fulfilment } : {}),
  };
}
