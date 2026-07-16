// Shop-order tracking use-cases, independent of HTTP. Mirrors orders.service's
// getOrderStatus but reads the ready-to-wear "Shop Orders" database and reports
// the Notion fulfilment "Status" workflow rather than the custom-order stages.

import {
  findShopOrderByNumber,
  fetchLiveShopOrderStatuses,
} from "../lib/notion/shop-orders.repository.js";
import { NotFoundError } from "../lib/errors.js";

export interface ShopOrderStatusView {
  orderNumber: string;
  status: string;
  statuses: string[];
  total?: number;
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

  return {
    orderNumber: order.orderNumber,
    status: order.status,
    statuses: timeline,
    ...(order.total !== undefined ? { total: order.total } : {}),
  };
}
